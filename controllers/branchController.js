const Branch = require("../models/branch");

const formatError = (error) => {
  if (error.name === "ValidationError") {
    const details = Object.values(error.errors).map((err) => err.message);
    return {
      status: 400,
      message: "Branch validation failed",
      details,
    };
  }

  return {
    status: 500,
    message: error.message || "An unexpected error occurred",
  };
};

exports.getBranches = async (_req, res) => {
  try {
    const branches = await Branch.find().sort({ createdAt: -1 });
    return res.json(branches);
  } catch (error) {
    const { status, message } = formatError(error);
    return res.status(status).json({ message });
  }
};

exports.createBranch = async (req, res) => {
  try {
    const branch = await Branch.create(req.body);
    return res.status(201).json(branch);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};

exports.getBranchById = async (req, res) => {
  try {
    const branch = await Branch.findById(req.params.id);

    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    return res.json(branch);
  } catch (error) {
    const { status, message } = formatError(error);
    return res.status(status).json({ message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const branch = await Branch.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    return res.json(branch);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const branch = await Branch.findByIdAndDelete(req.params.id);

    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    return res.json({ message: "Branch deleted" });
  } catch (error) {
    const { status, message } = formatError(error);
    return res.status(status).json({ message });
  }
};
