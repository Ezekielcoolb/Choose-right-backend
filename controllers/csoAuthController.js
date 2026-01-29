const jwt = require("jsonwebtoken");
const CSO = require("../models/cso");

const JWT_SECRET = process.env.JWT_SECRET || "development-secret";

const formatAuthError = (message = "Invalid credentials") => ({
  status: 401,
  message,
});

const sanitizeCso = (csoDocument) => {
  if (!csoDocument) return null;
  const cso = csoDocument.toObject();
  delete cso.password;
  return cso;
};

exports.loginCso = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      const { status, message } = formatAuthError("Identifier and password are required");
      return res.status(status).json({ message });
    }

    const normalizedIdentifier = identifier.trim();

    const cso = await CSO.findOne({
      $or: [{ email: normalizedIdentifier.toLowerCase() }, { workId: normalizedIdentifier }],
    }).select("+password");

    if (!cso) {
      const { status, message } = formatAuthError();
      return res.status(status).json({ message });
    }

    const passwordMatch = await cso.comparePassword(password);
    if (!passwordMatch) {
      const { status, message } = formatAuthError();
      return res.status(status).json({ message });
    }

    const token = jwt.sign(
      {
        sub: cso._id.toString(),
        role: "CSO",
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.json({
      token,
      cso: sanitizeCso(cso),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to login" });
  }
};

exports.getCsoProfile = async (req, res) => {
  try {
    const cso = await CSO.findById(req.csoId);
    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    return res.json(sanitizeCso(cso));
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to fetch profile" });
  }
};

exports.changeCsoPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new passwords are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters long" });
    }

    const cso = await CSO.findById(req.csoId).select("+password");
    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    const matches = await cso.comparePassword(currentPassword);
    if (!matches) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    cso.password = newPassword;
    await cso.save();

    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to update password" });
  }
};
