const jwt = require("jsonwebtoken");
const Admin = require("../models/admin");

const JWT_SECRET = process.env.JWT_SECRET || "development-secret";

const sanitizeAdmin = (adminDoc) => {
  if (!adminDoc) return null;
  const admin = adminDoc.toObject();
  delete admin.password;
  return admin;
};

exports.signupAdmin = async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Single admin restriction: Delete any existing admin
    await Admin.deleteMany({});

    const newAdmin = new Admin({
      firstName,
      lastName,
      email: email.toLowerCase(),
      password,
    });

    await newAdmin.save();

    const token = jwt.sign(
      {
        sub: newAdmin._id.toString(),
        role: "Admin",
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.status(201).json({
      message:
        "Admin signed up successfully. Previous admin (if any) has been replaced.",
      token,
      admin: sanitizeAdmin(newAdmin),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Error during admin signup" });
  }
};

exports.loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() }).select(
      "+password",
    );

    if (!admin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        sub: admin._id.toString(),
        role: "Admin",
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.json({
      token,
      admin: sanitizeAdmin(admin),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Error during admin login" });
  }
};

exports.getAdminProfile = async (req, res) => {
  try {
    const admin = await Admin.findById(req.adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }
    return res.json(sanitizeAdmin(admin));
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Error fetching admin profile" });
  }
};

exports.changeAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current and new passwords are required" });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "New password must be at least 8 characters long" });
    }

    const admin = await Admin.findById(req.adminId).select("+password");
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    admin.password = newPassword;
    await admin.save();

    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Failed to update password" });
  }
};
