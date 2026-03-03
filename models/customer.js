const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const customerSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
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
    password: { type: String, select: false },
  },
  { timestamps: true },
);

customerSchema.index({ csoId: 1, createdAt: -1 });
customerSchema.index({ phone: 1 }, { unique: false });
customerSchema.index({ firstName: "text", lastName: "text", phone: "text" });

customerSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password") || !this.password) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

customerSchema.methods.comparePassword = async function (candidate) {
  if (!this.password) return false;
  try {
    return await bcrypt.compare(candidate, this.password);
  } catch (error) {
    return this.password === candidate; // Fallback for plain text if any
  }
};

module.exports = mongoose.model("Customer", customerSchema);
