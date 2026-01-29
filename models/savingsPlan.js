const mongoose = require("mongoose");

const loanRequestSchema = new mongoose.Schema(
  {
    amount: { type: Number },
    dailyAmount: { type: Number },
    dailyRepaymentAmount: { type: Number },
    status: {
      type: String,
      enum: ["pending", "rejected", "cancelled"],
      default: "pending",
    },
    requestDate: { type: Date },
    guarantor: {
      name: { type: String },
      address: { type: String },
      phone: { type: String },
      relationship: { type: String },
    },
    customerSignature: { type: String },
  },
  { _id: false, id: false },
);

const loanDetailsSchema = new mongoose.Schema(
  {
    amount: { type: Number },
    dailyAmount: { type: Number },
    dailyRepaymentAmount: { type: Number },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "active", "completed"],
      default: "pending",
    },
    requestDate: { type: Date },
    approvalDate: { type: Date },
    startDate: { type: Date },
    endDate: { type: Date },
    guarantor: {
      name: { type: String },
      address: { type: String },
      phone: { type: String },
      relationship: { type: String },
    },
    customerSignature: { type: String },
    maintenanceFeePaid: { type: Boolean, default: false },
  },
  { _id: false, id: false },
);

const savingsPlanSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    csoId: { type: mongoose.Schema.Types.ObjectId, ref: "CSO", required: true },
    planName: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    dailyContribution: { type: Number, required: true, min: 0 },
    maintenanceFee: { type: Number, min: 0 },
    targetAmount: { type: Number, min: 0 },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch" },
    planType: {
      type: String,
      enum: ["saving", "loan"],
      default: "saving",
    },
    status: {
      type: String,
      enum: ["active", "completed", "closed"],
      default: "active",
    },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    totalDeposited: { type: Number, default: 0 },
    totalFees: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },
    lastFeeMonth: { type: String }, // format YYYY-MM
    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Loan Fields
    isLoan: { type: Boolean, default: false },
    loanStatus: {
      type: String,
      enum: ["none", "pending", "rejected", "approved", "active", "completed"],
      default: "none",
    },
    lastLoanRequestAt: { type: Date },
    lastLoanRequestAmount: { type: Number },
    loanStatusUpdatedAt: { type: Date },
    loanRequest: {
      type: loanRequestSchema,
      default: undefined,
    },
    loanDetails: {
      type: loanDetailsSchema,
      default: undefined,
    },
  },
  { timestamps: true },
);

savingsPlanSchema.pre("save", function deriveMaintenanceFee() {
  if (
    this.isModified("dailyContribution") &&
    !this.isModified("maintenanceFee")
  ) {
    this.maintenanceFee = this.dailyContribution;
  }
});

savingsPlanSchema.index({ customerId: 1, createdAt: -1 });
savingsPlanSchema.index({ csoId: 1, status: 1, createdAt: -1 });
savingsPlanSchema.index({ status: 1, startDate: -1 });

module.exports = mongoose.model("SavingsPlan", savingsPlanSchema);
