const SavingsEntry = require("../models/savingsEntry");
const CSO = require("../models/cso");
const mongoose = require("mongoose");

exports.getFeeReport = async (req, res) => {
  try {
    const { timeframe, specificMonth, csoId, page = 1, limit = 50 } = req.query;
    const query = { type: "fee" };

    // Date Filtering
    if (timeframe) {
      const now = new Date();
      const startOfToday = new Date(now.setHours(0, 0, 0, 0));

      if (timeframe === "today") {
        query.recordedAt = { $gte: startOfToday };
      } else if (timeframe === "week") {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        query.recordedAt = { $gte: startOfWeek };
      } else if (timeframe === "month") {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        query.recordedAt = { $gte: startOfMonth };
      }
    } else if (specificMonth) {
      const [year, month] = specificMonth.split("-");
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      query.recordedAt = { $gte: startDate, $lte: endDate };
    }

    // CSO Filtering
    if (csoId && mongoose.Types.ObjectId.isValid(csoId)) {
      query.csoId = new mongoose.Types.ObjectId(csoId);
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch Data and Totals
    const [entries, totalCount, totals] = await Promise.all([
      SavingsEntry.find(query)
        .populate("customerId", "firstName lastName phone")
        .populate("planId", "planName planType dailyContribution")
        .populate("csoId", "firstName lastName branchName")
        .sort({ recordedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      SavingsEntry.countDocuments(query),
      SavingsEntry.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalMaintenance: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      "$narration",
                      [
                        "Monthly maintenance fee",
                        "Daily contribution adjustment maintenance fee",
                      ],
                    ],
                  },
                  "$amount",
                  0,
                ],
              },
            },
            totalLoanFees: {
              $sum: {
                $cond: [
                  { $eq: ["$narration", "Loan Maintenance Fee"] },
                  "$amount",
                  0,
                ],
              },
            },
            totalOtherFees: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $not: [
                          {
                            $in: [
                              "$narration",
                              [
                                "Monthly maintenance fee",
                                "Daily contribution adjustment maintenance fee",
                              ],
                            ],
                          },
                        ],
                      },
                      { $ne: ["$narration", "Loan Maintenance Fee"] },
                    ],
                  },
                  "$amount",
                  0,
                ],
              },
            },
            grandTotal: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    const resultTotals =
      totals.length > 0
        ? totals[0]
        : {
            totalMaintenance: 0,
            totalLoanFees: 0,
            totalOtherFees: 0,
            grandTotal: 0,
          };

    return res.json({
      entries,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(totalCount / parseInt(limit)),
      },
      totals: resultTotals,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Unable to fetch fee report" });
  }
};
