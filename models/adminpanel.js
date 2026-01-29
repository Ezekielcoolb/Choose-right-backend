const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const VALID_ROLES = [
  "Manager",
];

const adminMemberSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    branchName: { type: String, required: true, trim: true },
    branchId: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    phone: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    assignedRole: {
      type: String,
      required: true,
      enum: VALID_ROLES,
    },
    gender: { type: String, required: true, trim: true },
    isSuspended: { type: Boolean, default: false },
  },
  { timestamps: true }
);

adminMemberSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password") || !this.password) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

adminMemberSchema.pre("findOneAndUpdate", async function hashUpdatedPassword() {
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

adminMemberSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

const AdminMember = mongoose.model("AdminPanel", adminMemberSchema);
module.exports = AdminMember;
