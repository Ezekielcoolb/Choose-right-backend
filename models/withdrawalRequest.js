const mongoose = require("mongoose");

const withdrawalRequestSchema = new mongoose.Schema(
  {
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SavingsPlan",
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    csoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CSO",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    narration: {
      type: String,
      trim: true,
    },
    recordedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    responseNote: {
      type: String,
      trim: true,
    },
    processedAt: {
      type: Date,
    },
    processedBy: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

withdrawalRequestSchema.index({ planId: 1, createdAt: -1 });
withdrawalRequestSchema.index({ status: 1, createdAt: -1 });
withdrawalRequestSchema.index({ csoId: 1, createdAt: -1 });

module.exports = mongoose.model("WithdrawalRequest", withdrawalRequestSchema);
