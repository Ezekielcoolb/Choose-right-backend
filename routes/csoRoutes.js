const express = require("express");
const {
  getCsos,
  createCso,
  getCsoById,
  updateCso,
  updateCsoStatus,
  recordRemittance,
} = require("../controllers/csoController");

const router = express.Router();

router
  .route("/")
  .get(getCsos)
  .post(createCso);

router
  .route("/:id")
  .get(getCsoById)
  .put(updateCso);

router.patch("/:id/status", updateCsoStatus);
router.post("/:id/remittance", recordRemittance);

module.exports = router;
