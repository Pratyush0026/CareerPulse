// Job-search experiments measured on the user's own board. The maths is deliberately simple
// (rates and counts) and every result says how much – or how little – it can be trusted.
import Experiment, { EXPERIMENT_TEMPLATES, EXPERIMENT_METRICS, EXPERIMENT_COMPARISONS } from '../models/Experiment.js';
import Application, { PLATFORMS } from '../models/Application.js';
import StageHistory from '../models/StageHistory.js';

export class ExperimentInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 90;
// Below this many applications in a group, a difference in rates is mostly noise.
const MIN_GROUP_SIZE = 10;
const NOTABLE_DIFFERENCE = 15;

// What counts as a "hit" for each metric, judged by every stage the application ever reached.
const METRICS = {
  response_rate: { label: 'response rate', stages: ['Assessment', 'Interview', 'Offer', 'Rejected'] },
  interview_rate: { label: 'interview rate', stages: ['Interview', 'Offer'] },
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Each application's start date, platform and every stage it has been in. */
async function boardHistory(userId) {
  const apps = await Application.find({ userId }, { platform: 1, stage: 1, firstEmailAt: 1, createdAt: 1 }).lean();
  const history = await StageHistory.find({ applicationId: { $in: apps.map((a) => a._id) } }, { applicationId: 1, toStage: 1 }).lean();

  const reached = new Map(apps.map((a) => [String(a._id), new Set([a.stage])]));
  for (const h of history) reached.get(String(h.applicationId))?.add(h.toStage);

  return apps.map((a) => ({ platform: a.platform, startedAt: a.firstEmailAt ?? a.createdAt, reached: reached.get(String(a._id)) }));
}

function measure(label, applications, metric, from, to) {
  const inWindow = applications.filter((a) => a.startedAt >= from && a.startedAt < to);
  const hits = inWindow.filter((a) => METRICS[metric].stages.some((s) => a.reached.has(s))).length;
  return {
    label,
    from,
    to,
    applications: inWindow.length,
    hits,
    rate: inWindow.length ? Math.round((hits / inWindow.length) * 100) : null,
  };
}

function groupsFor(experiment, applications, now) {
  const start = new Date(experiment.startDate);
  const end = new Date(Math.min(new Date(experiment.endDate), now));
  if (experiment.comparison === 'platforms') {
    return experiment.platforms.map((platform) =>
      measure(platform, applications.filter((a) => a.platform === platform), experiment.metric, start, end)
    );
  }
  const length = new Date(experiment.endDate) - start;
  return [
    measure('Before', applications, experiment.metric, new Date(start - length), start),
    measure('During', applications, experiment.metric, start, end),
  ];
}

function interpret(experiment, groups, { running }) {
  const metric = METRICS[experiment.metric].label;
  const limitations = [];

  const small = groups.filter((g) => g.applications < MIN_GROUP_SIZE);
  if (small.length) {
    limitations.push(
      `${small.map((g) => `${g.label}: ${plural(g.applications, 'application')}`).join(', ')}. That’s too few to compare reliably – aim for ${MIN_GROUP_SIZE}+ in each group.`
    );
  }
  limitations.push('This isn’t a controlled test. Other things changed at the same time, so a difference doesn’t prove the action caused it.');
  if (experiment.comparison === 'before_after') {
    limitations.push('Recent applications have had less time to hear back, which can make the later period look worse than it is.');
  }
  if (running) limitations.push('Still running, so these numbers will change.');

  let conclusion;
  if (small.length) {
    conclusion = 'Not enough applications yet to say anything.';
  } else {
    const [a, b] = groups;
    const gap = b.rate - a.rate;
    conclusion =
      Math.abs(gap) < NOTABLE_DIFFERENCE
        ? `No clear difference in ${metric} (${a.label} ${a.rate}%, ${b.label} ${b.rate}%).`
        : `${gap > 0 ? b.label : a.label} had a higher ${metric} (${Math.max(a.rate, b.rate)}% vs ${Math.min(a.rate, b.rate)}%). Worth noting, but not proof of cause.`;
  }
  return { conclusion, limitations };
}

function parseInput(body = {}) {
  const startDate = new Date(body.startDate);
  const endDate = new Date(body.endDate);
  const fields = {
    template: EXPERIMENT_TEMPLATES.includes(body.template) ? body.template : 'custom',
    hypothesis: text(body.hypothesis, 300),
    action: text(body.action, 500),
    metric: body.metric,
    comparison: body.comparison,
    platforms: Array.isArray(body.platforms) ? [...new Set(body.platforms)] : [],
    startDate,
    endDate,
  };

  if (!fields.hypothesis || !fields.action) throw new ExperimentInputError('Describe what you expect to happen and what you’ll do.');
  if (!EXPERIMENT_METRICS.includes(fields.metric)) throw new ExperimentInputError('Choose what to measure.');
  if (!EXPERIMENT_COMPARISONS.includes(fields.comparison)) throw new ExperimentInputError('Choose what to compare.');
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    throw new ExperimentInputError('The end date must be after the start date.');
  }
  if (endDate - startDate > MAX_DAYS * DAY_MS) throw new ExperimentInputError(`Keep experiments to ${MAX_DAYS} days or less.`);
  if (fields.comparison === 'platforms') {
    if (fields.platforms.length !== 2 || !fields.platforms.every((p) => PLATFORMS.includes(p))) {
      throw new ExperimentInputError('Pick two different platforms to compare.');
    }
  } else {
    fields.platforms = [];
  }
  return fields;
}

export async function createExperiment(userId, body) {
  const fields = parseInput(body);
  // A retried request (double click, flaky network) returns the experiment it already created.
  const existing = await Experiment.findOne({ userId, status: 'active', hypothesis: fields.hypothesis, startDate: fields.startDate });
  if (existing) return existing;
  return Experiment.create({ ...fields, userId });
}

function freeze(experiment, applications, now) {
  const groups = groupsFor(experiment, applications, now);
  experiment.result = { groups, ...interpret(experiment, groups, { running: false }), computedAt: now };
}

/**
 * The user's experiments. Running ones are measured live; finished ones keep the result they
 * had when they ended. Experiments past their end date are finished on the way.
 */
export async function listExperiments(userId, now = new Date()) {
  const experiments = await Experiment.find({ userId }).sort({ createdAt: -1 }).limit(50);
  if (!experiments.length) return [];
  const applications = await boardHistory(userId);

  return Promise.all(
    experiments.map(async (experiment) => {
      if (experiment.status === 'active' && experiment.endDate <= now) {
        experiment.status = 'finished';
        freeze(experiment, applications, experiment.endDate);
        await experiment.save();
      }
      const view = experiment.toObject();
      if (experiment.status === 'active') {
        const groups = groupsFor(experiment, applications, now);
        view.result = { groups, ...interpret(experiment, groups, { running: true }) };
      }
      return view;
    })
  );
}

/** Finish (freezing the result), abandon, or note what was observed. */
export async function updateExperiment(userId, id, { action, observedOutcome } = {}) {
  const experiment = await Experiment.findOne({ _id: id, userId });
  if (!experiment) return null;

  if (action === 'finish' || action === 'abandon') {
    if (experiment.status !== 'active') throw new ExperimentInputError('This experiment has already ended.');
    experiment.status = action === 'finish' ? 'finished' : 'abandoned';
    if (action === 'finish') freeze(experiment, await boardHistory(userId), new Date());
  } else if (action !== undefined) {
    throw new ExperimentInputError('Unknown action.');
  }
  if (observedOutcome !== undefined) experiment.observedOutcome = text(observedOutcome, 1000);
  await experiment.save();
  return experiment;
}
