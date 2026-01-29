const AdminMember = require("../models/adminpanel");

const formatError = (error) => {
  if (error?.name === "ValidationError") {
    const details = Object.values(error.errors || {}).map((err) => err.message);
    return { status: 400, message: "Validation failed", details };
  }

  if (error?.code === 11000) {
    const duplicatedFields = Object.keys(error.keyPattern || {});
    return {
      status: 409,
      message: `Duplicate value for field(s): ${duplicatedFields.join(", ")}`,
    };
  }

  return {
    status: 500,
    message: error?.message || "An unexpected error occurred",
  };
};

exports.listAdminMembers = async (_req, res) => {
  try {
    const members = await AdminMember.find().sort({ createdAt: -1 });
    return res.json(members);
  } catch (error) {
    const { status, message } = formatError(error);
    return res.status(status).json({ message });
  }
};

exports.getAdminMember = async (req, res) => {
  try {
    const member = await AdminMember.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: "Admin member not found" });
    }
    return res.json(member);
  } catch (error) {
    const { status, message } = formatError(error);
    return res.status(status).json({ message });
  }
};

exports.createAdminMember = async (req, res) => {
  try {
    const payload = { ...req.body };
    const member = await AdminMember.create(payload);
    return res.status(201).json(member);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};

exports.updateAdminMember = async (req, res) => {
  try {
    const payload = { ...req.body };
    const member = await AdminMember.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
      context: "query",
    });

    if (!member) {
      return res.status(404).json({ message: "Admin member not found" });
    }

    return res.json(member);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};

exports.toggleSuspendMember = async (req, res) => {
  try {
    const { isSuspended } = req.body;
    if (typeof isSuspended !== "boolean") {
      return res.status(400).json({ message: "isSuspended must be a boolean" });
    }

    const member = await AdminMember.findByIdAndUpdate(
      req.params.id,
      { isSuspended },
      { new: true, runValidators: true, context: "query" },
    );

    if (!member) {
      return res.status(404).json({ message: "Admin member not found" });
    }

    return res.json(member);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};
