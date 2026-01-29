const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const csoSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    branchName: { type: String, required: true },
    branchId: { type: String, required: true },
    address: { type: String, required: true },
    workId: { type: String, required: true },
    password: { type: String, select: false },
    guaratorName: { type: String, required: true },
    guaratorAddress: { type: String, required: true },
    guaratorPhone: { type: String, required: true },
    guaratorEmail: { type: String },
    dateOfBirth: { type: Date },
    profileImg: { type: String },
    signature: { type: String },

    isActive: { type: Boolean, default: true },
    remittance: [
      {
        amountCollected: { type: String, default: "0" },
        amountPaid: { type: String, default: "0" },
        // image: { type: String },
        amountRemitted: { type: Number, default: 0 },
        issueResolution: { type: String, default: "" },
        remark: { type: String },
        resolvedIssue: { type: String, default: "" },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
      },
    ],


  },
  { timestamps: true },
);

csoSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password") || !this.password) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

csoSchema.pre("findOneAndUpdate", async function hashUpdatedPassword() {
  const update = this.getUpdate();

  if (!update) {
    return;
  }

  const password = update.password || update.$set?.password;

  if (!password) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(password, salt);

  if (update.password) {
    update.password = hashed;
  }

  if (update.$set?.password) {
    update.$set.password = hashed;
  }

  this.setUpdate(update);
});

csoSchema.methods.comparePassword = async function comparePassword(candidate) {
  if (!this.password) {
    return false;
  }

  try {
    const match = await bcrypt.compare(candidate, this.password);
    if (match) {
      return true;
    }
  } catch (error) {
    // fall through to plain-text comparison
  }

  return this.password === candidate;
};

csoSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

const CSO = mongoose.model("CSO", csoSchema);

module.exports = CSO;
