const express = require("express");
const { userAuth } = require("../middlewares/authMiddlewares");
const { addExtractionRecord, getAllExtractionRecords, getExtractionDataForEmployee, getExtractionRecordsForAMonth, getExtractionReportForAdmins } = require("../controllers/extractionRecordControllers");
const router = express.Router();


router.post("/record/extraction/add", userAuth, addExtractionRecord);
router.get("/record/extraction/get-all", getAllExtractionRecords);
router.get("/record/extraction/for-employee", userAuth,  getExtractionDataForEmployee);
router.get("/record/extraction/for-a-month", getExtractionRecordsForAMonth);
router.get("/record/extraction/report-for-admins", getExtractionReportForAdmins);

module.exports = router;