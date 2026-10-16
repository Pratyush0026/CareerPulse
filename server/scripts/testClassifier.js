// Accuracy check for the classifier: npm run test:classifier
// Sends sample emails to Gemini and compares the result with what we expect. Only needs GEMINI_API_KEY.
import config from '../config/index.js';
import { classifyBatch } from '../services/classifier.js';

// expected: stage, or null for "not job related". expectedDate also checks date/timezone handling.
const SAMPLES = [
  {
    name: 'KPMG interview (sent 00:43 IST, "Monday")',
    expected: 'Interview',
    expectedDate: '2026-09-28',
    email: {
      sender: '"Boral, Pooja" <poojaboral@kpmg.com>',
      subject: 'Your L1 Interview is scheduled| KPMG India',
      // 00:43 IST on Saturday 26 Sept, so "Monday" is the 28th
      date: new Date('2026-09-25T19:13:00Z'),
      body: 'Dear Candidate, Greetings of the day! Thank you for showing interest and applying with KPMG India. After careful consideration of your candidature, we are excited to invite you for the L1 interview for the Next.js Developer position. Date & Time: Monday, 3:00 PM-4:00 PM. Mode: Virtual (Microsoft Teams). Link: https://teams.microsoft.com/meet/341269218987695',
    },
  },
  {
    name: 'Naukri application confirmation',
    expected: 'Applied',
    email: {
      sender: 'Naukri <info@naukri.com>',
      subject: 'Application sent: Business Analyst at Mphasis',
      date: '2026-10-01',
      body: 'Dear Candidate, your application for the post of Business Analyst at Mphasis Limited, Pune has been sent successfully. Recruiters usually respond within 2 weeks. Track your application status in My Naukri.',
    },
  },
  {
    name: 'TCS assessment via HackerRank',
    expected: 'Assessment',
    email: {
      sender: 'TCS Talent Acquisition via HackerRank <support@hackerrankforwork.com>',
      subject: 'TCS Digital – Online Coding Assessment Invitation',
      date: '2026-10-02',
      body: 'Hi Ananya, Thank you for applying to TCS Digital. You are invited to complete the online coding assessment for the Data Analyst position. The test is 90 minutes long and must be completed by 8 October 2026. Start your test here: https://www.hackerrank.com/tests/tcsdigital-2026/xyz789. All the best!',
    },
  },
  {
    name: 'Infosys interview invite',
    expected: 'Interview',
    email: {
      sender: 'Infosys Recruitment <recruitment@infosys.com>',
      subject: 'Interview Invitation – Systems Engineer | Infosys',
      date: '2026-10-03',
      body: 'Dear Candidate, Congratulations! You have been shortlisted for the technical interview for the Systems Engineer role. Date: 10 October 2026, Time: 2:30 PM IST. Mode: Microsoft Teams. Join link: https://teams.microsoft.com/l/meetup-join/abc123. Please keep your resume and ID proof ready.',
    },
  },
  {
    name: 'Startup rejection',
    expected: 'Rejected',
    email: {
      sender: 'Hiring Team <careers@groww.in>',
      subject: 'Your application for Product Analyst at Groww',
      date: '2026-10-04',
      body: 'Hi Ananya, thank you for taking the time to interview with us for the Product Analyst role. We were impressed by your background; however, we regret to inform you that we have decided to move forward with other candidates whose experience more closely matches our current needs. We wish you the best.',
    },
  },
  {
    name: 'LinkedIn job alert newsletter',
    expected: null,
    email: {
      sender: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
      subject: '30+ new "Product Manager" jobs in Bengaluru',
      date: '2026-10-05',
      body: 'Your job alert for Product Manager in Bengaluru, Karnataka. New jobs match your preferences: Product Manager – Razorpay, Associate PM – CRED, Senior PM – Meesho. Easy Apply. See all jobs. Unsubscribe from job alerts.',
    },
  },
  {
    name: 'foundit "jobs for you" email',
    expected: null,
    email: {
      sender: 'foundit <jobs@foundit.in>',
      subject: 'Ananya, 12 jobs picked for you today',
      date: '2026-10-05',
      body: 'Recommended jobs based on your profile: Operations Executive at Zomato (3-6 LPA), Data Analyst at Genpact, MIS Executive at Teleperformance. Apply now. Update your profile to get better matches.',
    },
  },
  {
    name: 'Offer letter',
    expected: 'Offer',
    email: {
      sender: 'HR Team <hr@freshworks.com>',
      subject: 'Offer Letter – Customer Success Associate',
      date: '2026-10-06',
      body: 'Dear Ananya, We are delighted to offer you the position of Customer Success Associate at Freshworks Technologies Pvt Ltd, Chennai, with an annual CTC of INR 9,00,000. Please find your offer letter attached and confirm your acceptance by 15 October 2026.',
    },
  },
  {
    name: 'Quess application confirmation',
    expected: 'Applied',
    email: {
      sender: 'Quess Corp Careers <careers@quesscorp.com>',
      subject: 'Thank you for applying – Relationship Manager',
      date: '2026-10-07',
      body: 'Hi Ananya, thank you for applying for the Relationship Manager role with Quess Corp, Bengaluru. Our recruitment team is reviewing your profile and will reach out if your experience matches the requirement.',
    },
  },
  {
    name: 'Flipkart take-home assignment',
    expected: 'Assessment',
    email: {
      sender: 'Flipkart Hiring <hiring@flipkart.com>',
      subject: 'Next round: Case study assignment – Category Manager',
      date: '2026-10-08',
      body: 'Hello, thanks for your interest in the Category Manager role. As the next round, please complete the attached case study and submit it within 3 days using this form: https://forms.flipkart.com/case-study-cm. Reach out if you have questions.',
    },
  },
  {
    name: 'Course marketing (not job related)',
    expected: null,
    email: {
      sender: 'upGrad <offers@upgrad.com>',
      subject: 'Get interview-ready: 50% off our Data Science program',
      date: '2026-10-09',
      body: 'Crack your next interview! Enroll in our Data Science certification and get placement assistance with 300+ hiring partners. Offer ends Sunday. Book a free counselling session today.',
    },
  },
];

async function main() {
  if (!config.gemini.apiKey) {
    console.error('\n❌ GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.\n');
    process.exit(1);
  }

  console.log(`\nCareerPulse classifier test`);
  console.log(`Model: ${config.gemini.model} | delay between calls: ${config.gemini.delayMs} ms`);

  let correct = 0;
  const rows = [];

  console.log(`Sending ${SAMPLES.length} sample emails in one batched request...
`);
  const results = await classifyBatch(SAMPLES.map((s) => s.email));

  for (const [i, sample] of SAMPLES.entries()) {
    process.stdout.write(`  [${i + 1}/${SAMPLES.length}] ${sample.name}... `);
    const result = results[i];

    if (!result) {
      console.log('ERROR');
      rows.push({ Sample: sample.name, Expected: sample.expected ?? 'not job', Predicted: 'ERROR', Company: '-', Conf: '-', OK: '❌' });
      continue;
    }

    const predicted = result.is_job_related ? result.stage : null;
    const ok = predicted === sample.expected && (!sample.expectedDate || result.event_date === sample.expectedDate);
    if (ok) correct++;
    console.log(ok ? 'ok' : 'MISMATCH');

    rows.push({
      Sample: sample.name,
      Expected: sample.expected ?? 'not job',
      Predicted: predicted ?? 'not job',
      Company: result.company ?? '-',
      Role: result.role ?? '-',
      Date: result.event_date ?? '-',
      Conf: result.confidence.toFixed(2),
      OK: ok ? '✅' : '❌',
    });
  }

  console.log();
  console.table(rows);
  const accuracy = ((correct / SAMPLES.length) * 100).toFixed(1);
  console.log(`\nAccuracy: ${correct}/${SAMPLES.length} = ${accuracy}%\n`);
  process.exit(correct === SAMPLES.length ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
