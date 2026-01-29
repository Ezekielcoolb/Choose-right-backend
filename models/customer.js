const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date },
    identificationType: { type: String },
    identificationNumber: { type: String },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch" },
    branchName: { type: String },
    csoId: { type: mongoose.Schema.Types.ObjectId, ref: "CSO", required: true },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

customerSchema.index({ csoId: 1, createdAt: -1 });
customerSchema.index({ phone: 1 }, { unique: false });
customerSchema.index({ firstName: "text", lastName: "text", phone: "text" });

module.exports = mongoose.model("Customer", customerSchema);
