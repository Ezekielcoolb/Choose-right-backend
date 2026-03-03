const express = require("express");
const {
  getCsos,
  createCso,
  getCsoById,
  updateCso,
  deleteCso,
  updateCsoStatus,
  recordRemittance,
  adjustRemittance,
  deleteRemittance,
} = require("../controllers/csoController");

const router = express.Router();

router.route("/").get(getCsos).post(createCso);

router.route("/:id").get(getCsoById).put(updateCso).delete(deleteCso);

router.patch("/:id/status", updateCsoStatus);
router.post("/:id/remittance", recordRemittance);
router.patch("/:id/remittance/:remittanceId/adjust", adjustRemittance);
router.delete("/:id/remittance/:remittanceId", deleteRemittance);

module.exports = router;
