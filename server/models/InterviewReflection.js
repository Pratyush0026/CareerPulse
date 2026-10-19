// What the user chose to note down after an interview. Everything here is optional and only
// ever comes from the user – a stage change on its own says nothing about how it went.
import mongoose from 'mongoose';

const interviewReflectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', default: null },
    // Copied from the application so the notes still make sense if the card is deleted.
    company: { type: String, required: true, trim: true },
    role: { type: String, default: '', trim: true },
    stage: { type: String, default: 'Interview' },
    occurredOn: { type: Date, default: null },
    topics: { type: [String], default: [] },
    difficultQuestions: { type: [String], default: [] },
    feedback: { type: String, default: '', maxlength: 2000 },
    // Areas the user wants to practise. These, and only these, become practice tasks.
    practiceAreas: { type: [String], default: [] },

    // Suggestions Gemini made from these notes, only when the user asked. Each one quotes the
    // note lines it came from. Cleared when the notes they were based on change.
    insights: {
      type: new mongoose.Schema(
        {
          feedbackSummary: { type: String, default: '' },
          themes: [{ _id: false, name: String, fromNotes: [String] }],
          learningNeeds: [{ _id: false, area: String, why: String, practice: String, basedOn: [String] }],
          notesHash: String,
          promptVersion: String,
          generatedAt: Date,
        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { timestamps: true }
);

// One set of notes per application, so saving twice updates instead of duplicating.
interviewReflectionSchema.index(
  { userId: 1, applicationId: 1 },
  { unique: true, partialFilterExpression: { applicationId: { $type: 'objectId' } } }
);

export default mongoose.model('InterviewReflection', interviewReflectionSchema);
