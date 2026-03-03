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

const getLocalDateKey = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const offsetDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000,
  );
  return offsetDate.toISOString().slice(0, 10);
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
    const {
      amountCollected,
      amountPaid,
      amountRemitted,
      remark,
      resolution,
      issueResolution,
      resolvedIssue,
      resolutionDate,
      remittanceId,
    } = req.body || {};

    const hasAmountCollected = amountCollected !== undefined;
    const hasAmountPaid = amountPaid !== undefined;
    const hasAmountRemitted = amountRemitted !== undefined;
    const hasResolution = resolution !== undefined;

    const collectedNumber = hasAmountCollected ? Number(amountCollected) : null;
    const paidNumber = hasAmountPaid ? Number(amountPaid) : null;
    const remittedNumber = hasAmountRemitted ? Number(amountRemitted) : null;
    const resolutionNumberRaw = hasResolution ? Number(resolution) : null;

    if (
      hasAmountCollected &&
      (!Number.isFinite(collectedNumber) || collectedNumber < 0)
    ) {
      return res
        .status(400)
        .json({ message: "amountCollected must be a non-negative number" });
    }

    if (hasAmountPaid && (!Number.isFinite(paidNumber) || paidNumber < 0)) {
      return res
        .status(400)
        .json({ message: "amountPaid must be a non-negative number" });
    }

    if (
      hasAmountRemitted &&
      (!Number.isFinite(remittedNumber) || remittedNumber < 0)
    ) {
      return res
        .status(400)
        .json({ message: "amountRemitted must be a non-negative number" });
    }

    if (
      hasResolution &&
      (!Number.isFinite(resolutionNumberRaw) || resolutionNumberRaw < 0)
    ) {
      return res
        .status(400)
        .json({ message: "resolution must be a non-negative number" });
    }

    const resolutionNumber =
      Number.isFinite(resolutionNumberRaw) && resolutionNumberRaw >= 0
        ? resolutionNumberRaw
        : 0;

    const resolutionDateKey = getLocalDateKey(resolutionDate);

    const cso = await CSO.findById(id);
    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    let remittanceEntry = null;
    let existingIndex = -1;

    if (remittanceId) {
      const found = cso.remittance.id(remittanceId);
      if (!found) {
        return res.status(404).json({ message: "Remittance entry not found" });
      }
      remittanceEntry = found;
      existingIndex = cso.remittance.findIndex((entry) =>
        entry._id?.equals(found._id),
      );
    }

    if (!remittanceEntry && resolutionDateKey) {
      existingIndex = cso.remittance.findIndex((entry) => {
        const entryKey =
          getLocalDateKey(entry?.createdAt) ||
          getLocalDateKey(entry?.updatedAt);
        return entryKey === resolutionDateKey;
      });

      if (existingIndex !== -1) {
        remittanceEntry = cso.remittance[existingIndex];
      }
    }

    const isNewEntry = !remittanceEntry;

    if (isNewEntry) {
      remittanceEntry = {
        amountCollected: hasAmountCollected ? collectedNumber.toString() : "0",
        amountPaid: hasAmountPaid ? paidNumber.toString() : "0",
        amountRemitted: hasAmountRemitted
          ? remittedNumber
          : hasAmountPaid
            ? paidNumber
            : 0,
        remark: (remark || "").toString(),
        resolution: resolutionNumber,
        issueResolution: (issueResolution ?? "").toString(),
        resolvedIssue: (resolvedIssue ?? issueResolution ?? "").toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (resolutionDate) {
        const parsedResolutionDate = new Date(resolutionDate);
        if (!Number.isNaN(parsedResolutionDate.getTime())) {
          remittanceEntry.createdAt = parsedResolutionDate;
          remittanceEntry.updatedAt = parsedResolutionDate;
        }
      }

      cso.remittance.push(remittanceEntry);
      existingIndex = cso.remittance.length - 1;
    }

    if (hasAmountCollected) {
      remittanceEntry.amountCollected = collectedNumber.toString();
    }

    if (hasAmountPaid) {
      remittanceEntry.amountPaid = paidNumber.toString();
      remittanceEntry.amountRemitted = paidNumber;
    }

    if (hasAmountRemitted) {
      remittanceEntry.amountRemitted = remittedNumber;
    }

    if (remark !== undefined) {
      remittanceEntry.remark = (remark || "").toString();
    }

    if (hasResolution) {
      remittanceEntry.resolution = resolutionNumber;
    }

    if (issueResolution !== undefined) {
      remittanceEntry.issueResolution = (issueResolution ?? "").toString();
    }

    if (resolvedIssue !== undefined || issueResolution !== undefined) {
      const resolvedValue =
        resolvedIssue !== undefined
          ? resolvedIssue
          : (issueResolution ?? remittanceEntry.resolvedIssue);
      remittanceEntry.resolvedIssue = (resolvedValue ?? "").toString();
    }

    if (resolutionDate) {
      const parsedResolutionDate = new Date(resolutionDate);
      if (!Number.isNaN(parsedResolutionDate.getTime())) {
        remittanceEntry.updatedAt = parsedResolutionDate;
      }
    }

    if (!resolutionDate || Number.isNaN(new Date(resolutionDate).getTime())) {
      remittanceEntry.updatedAt = new Date();
    }

    if (existingIndex !== -1) {
      cso.remittance[existingIndex] = remittanceEntry;
    }

    cso.markModified("remittance");

    await cso.save();

    return res.status(isNewEntry ? 201 : 200).json(cso);
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
exports.deleteCso = async (req, res) => {
  try {
    const cso = await CSO.findByIdAndDelete(req.params.id);

    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    return res.json({ message: "CSO deleted successfully" });
  } catch (error) {
    const { status, message } = formatError(error);
    return res.status(status).json({ message });
  }
};

exports.adjustRemittance = async (req, res) => {
  try {
    const { id, remittanceId } = req.params;
    const { amount, action } = req.body; // action: 'add' | 'subtract'

    if (!amount || !["add", "subtract"].includes(action)) {
      return res.status(400).json({ message: "Invalid amount or action" });
    }

    const adjustValue = Number(amount);
    if (!Number.isFinite(adjustValue) || adjustValue <= 0) {
      return res
        .status(400)
        .json({ message: "Amount must be a positive number" });
    }

    const cso = await CSO.findById(id);
    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    const remittanceEntry = cso.remittance.id(remittanceId);
    if (!remittanceEntry) {
      return res.status(404).json({ message: "Remittance entry not found" });
    }

    const currentPaid = Number(remittanceEntry.amountPaid || 0);
    const currentRemitted = Number(remittanceEntry.amountRemitted || 0);

    let newPaid, newRemitted;
    if (action === "add") {
      newPaid = currentPaid + adjustValue;
      newRemitted = currentRemitted + adjustValue;
    } else {
      newPaid = Math.max(0, currentPaid - adjustValue);
      newRemitted = Math.max(0, currentRemitted - adjustValue);
    }

    remittanceEntry.amountPaid = newPaid.toString();
    remittanceEntry.amountRemitted = newRemitted;
    remittanceEntry.updatedAt = new Date();

    cso.markModified("remittance");
    await cso.save();

    return res.json(cso);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};

exports.deleteRemittance = async (req, res) => {
  try {
    const { id, remittanceId } = req.params;

    const cso = await CSO.findById(id);
    if (!cso) {
      return res.status(404).json({ message: "CSO not found" });
    }

    const remittanceEntry = cso.remittance.id(remittanceId);
    if (!remittanceEntry) {
      return res.status(404).json({ message: "Remittance entry not found" });
    }

    // Filter out the remittance entry
    cso.remittance = cso.remittance.filter(
      (entry) => entry._id.toString() !== remittanceId,
    );

    cso.markModified("remittance");
    await cso.save();

    return res.json(cso);
  } catch (error) {
    const { status, message, details } = formatError(error);
    return res.status(status).json({ message, details });
  }
};
