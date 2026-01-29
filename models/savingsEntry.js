const mongoose = require("mongoose");

const savingsEntrySchema = new mongoose.Schema(
  {
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "SavingsPlan", required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    csoId: { type: mongoose.Schema.Types.ObjectId, ref: "CSO", required: true },
    type: {
      type: String,
      enum: ["deposit", "fee", "withdrawal", "adjustment"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    narration: { type: String, trim: true },
    recordedAt: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "CSO", required: true },
    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

savingsEntrySchema.index({ planId: 1, recordedAt: -1 });
savingsEntrySchema.index({ customerId: 1, recordedAt: -1 });
savingsEntrySchema.index({ csoId: 1, recordedAt: -1 });

module.exports = mongoose.model("SavingsEntry", savingsEntrySchema);
