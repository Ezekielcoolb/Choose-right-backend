const CSO = require("../models/cso");
const Branch = require("../models/branch");

const formatError = (error) => {
  if (error.name === "ValidationError") {
    const details = Object.values(error.errors).map((err) => err.message);
    return {
      status: 400,
      message: "CSO validation failed",
      details,
    };
  }

  if (error.code === 11000) {
    const duplicatedFields = Object.keys(error.keyPattern || {});
    return {
      status: 409,
      message: `Duplicate value for field(s): ${duplicatedFields.join(", ")}`,
    };
  }

  return {
    status: 500,
    message: error.message || "An unexpected error occurred",
  };
};

exports.getCsos = async (_req, res) => {
  try {
    const csos = await CSO.find().sort({ createdAt: -1 });
    return res.json(csos);
  } catch (error) {
    const { status, message } = formatError(error);
    return res.status(status).json({ message });
  }
};

exports.getCsoById = async (req, res) => {
  try {
    const cso = await CSO.findById(req.params.id);

    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    return res.json(cso);
  } catch (error) {
    const { status, message } = formatError(error);
    return res.status(status).json({ message });
  }
};

exports.createCso = async (req, res) => {
  try {
    const { branchId } = req.body;

    if (!branchId) {
      return res.status(400).json({ message: "branchId is required" });
    }

    const branch = await Branch.findById(branchId);
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    const payload = {
      ...req.body,
      branchId: branch._id.toString(),
      branchName: branch.branchName,
      password: req.body.workId,
    };

    delete payload.branch;
    delete payload.branchName; // will be re-set just below to avoid user-provided overrides
    payload.branchName = branch.branchName;

    const cso = await CSO.create(payload);
    return res.status(201).json(cso);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};

exports.recordRemittance = async (req, res) => {
  try {
    const { id } = req.params;
    const { amountCollected, amountPaid, remark } = req.body || {};

    const collectedNumber = Number(amountCollected ?? 0);
    const paidNumber = Number(amountPaid ?? 0);

    if (!Number.isFinite(collectedNumber) || collectedNumber < 0) {
      return res.status(400).json({ message: "amountCollected must be a non-negative number" });
    }

    if (!Number.isFinite(paidNumber) || paidNumber < 0) {
      return res.status(400).json({ message: "amountPaid must be a non-negative number" });
    }

    const cso = await CSO.findById(id);
    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    const remittanceEntry = {
      amountCollected: collectedNumber.toString(),
      amountPaid: paidNumber.toString(),
      amountRemitted: paidNumber,
      remark: (remark || "").toString(),
      issueResolution: "",
      resolvedIssue: "",
    };

    cso.remittance.push(remittanceEntry);
    await cso.save();

    return res.status(201).json(cso);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};

exports.updateCso = async (req, res) => {
  try {
    const { branchId, workId } = req.body;
    const updates = { ...req.body };

    if (branchId) {
      const branch = await Branch.findById(branchId);
      if (!branch) {
        return res.status(404).json({ message: "Branch not found" });
      }
      updates.branchId = branch._id.toString();
      updates.branchName = branch.branchName;
    }

    if (workId && !updates.password) {
      updates.password = workId;
    }

    const cso = await CSO.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
      context: "query",
    });

    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    return res.json(cso);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};

exports.updateCsoStatus = async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }

    const cso = await CSO.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true, runValidators: true, context: "query" },
    );

    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    return res.json(cso);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};
