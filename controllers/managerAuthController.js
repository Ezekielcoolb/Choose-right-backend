const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const AdminMember = require("../models/adminpanel");

const JWT_SECRET = process.env.JWT_SECRET || "development-secret";

const formatAuthError = (message = "Invalid credentials") => ({
  status: 401,
  message,
});

const sanitizeManager = (memberDocument) => {
  if (!memberDocument) return null;
  const manager = memberDocument.toObject();
  delete manager.password;
  return manager;
};

exports.loginManager = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const manager = await AdminMember.findOne({
      email: normalizedEmail,
      assignedRole: "Manager",
    }).select("+password");

    if (!manager || manager.isSuspended) {
      const { status, message } = formatAuthError();
      return res.status(status).json({ message });
    }

    const passwordMatch = await bcrypt.compare(password, manager.password);
    if (!passwordMatch) {
      const { status, message } = formatAuthError();
      return res.status(status).json({ message });
    }

    const token = jwt.sign(
      {
        sub: manager._id.toString(),
        role: "Manager",
        branchId: manager.branchId,
        branchName: manager.branchName,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.json({
      token,
      manager: sanitizeManager(manager),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to login" });
  }
};

exports.getManagerProfile = async (req, res) => {
  try {
    const manager = await AdminMember.findOne({
      _id: req.managerId,
      assignedRole: "Manager",
    });

    if (!manager) {
      return res.status(404).json({ message: "Manager not found" });
    }

    return res.json(sanitizeManager(manager));
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to fetch profile" });
  }
};

exports.changeManagerPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current and new passwords are required" });
    }

    if (String(newPassword).length < 8) {
      return res
        .status(400)
        .json({ message: "New password must be at least 8 characters long" });
    }

    const manager = await AdminMember.findOne({
      _id: req.managerId,
      assignedRole: "Manager",
    }).select("+password");

    if (!manager) {
      return res.status(404).json({ message: "Manager not found" });
    }

    const passwordMatch = await bcrypt.compare(
      currentPassword,
      manager.password,
    );
    if (!passwordMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    manager.password = newPassword;
    await manager.save();

    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to update password" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body || {};

    if (!email || !newPassword) {
      return res
        .status(400)
        .json({ message: "Email and New Password are required" });
    }

    if (String(newPassword).length < 8) {
      return res
        .status(400)
        .json({ message: "New password must be at least 8 characters long" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const manager = await AdminMember.findOne({
      email: normalizedEmail,
      assignedRole: "Manager",
    });

    if (!manager) {
      return res
        .status(404)
        .json({ message: "No account found with the provided email" });
    }

    manager.password = newPassword;
    await manager.save();

    return res.json({
      message:
        "Password reset successful. You can now login with your new password.",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to process request" });
  }
};
