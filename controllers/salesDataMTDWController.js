const SalesDataMTDW = require("../models/SalesDataMTDW");
const csvParser = require("csv-parser");
const { Readable } = require("stream");
const { v4: uuidv4 } = require("uuid");
const { formatNumberIndian } = require("../helpers/salesHelpers");
const { fetchTargetValuesAndVolumesByChannel } = require("../helpers/reportHelpers");
const EmployeeCode = require("../models/EmployeeCode");


exports.uploadSalesDataMDTW = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    let results = [];

    if (req.file.originalname.endsWith(".csv")) {
      // Parse CSV file
      const stream = new Readable();
      stream.push(req.file.buffer);
      stream.push(null);
      stream
        .pipe(csvParser())
        .on("data", (data) => {
          // Collect all data rows first
          results.push(data);
        })
        .on("end", async () => {
          try {
            let newEntries = [];

            // Process each row asynchronously
            for (let data of results) {
              // Generate iuid by concatenating all the column values
              const iuid = Object.values(data).join('|'); // Join all values using a delimiter
              console.log("IUID: ", iuid)

              // Check if the iuid already exists in the database
              const existingRecord = await SalesDataMTDW.findOne({ iuid });

              if (!existingRecord) {
                // If iuid does not exist, add the iuid to the data
                data.iuid = iuid;

                // Extract month from the DATE field
                const dateParts = data.DATE.split("/");
                const month = dateParts[0]; // Assuming the DATE format is "MM/DD/YYYY"
                data.month = month;

                newEntries.push(data);
              }
            }

            if (newEntries.length > 0) {
              // Insert new entries into MongoDB
              await SalesDataMTDW.insertMany(newEntries);
              res.status(200).send("Data inserted into database");
            } else {
              res.status(200).send("No new data to insert, all entries already exist.");
            }
          } catch (error) {
            console.log(error);
            res.status(500).send("Error inserting data into database");
          }
        });
    } else {
      res.status(400).send("Unsupported file format");
    }
  } catch (error) {
    console.log(error);
    res.status(500).send("Internal server error");
  }
};

exports.getSalesDashboardDataMDTW = async (req, res) => {
  try {
    let { td_format, start_date, end_date, data_format, code } = req.query;

    // Validate that employee code is provided
    if (!code) {
      return res.status(400).send({ error: "Employee code is required." });
    }

    // Convert employee code to uppercase
    const employeeCodeUpper = code.toUpperCase();

    // Fetch employee details based on the code
    const employee = await EmployeeCode.findOne({ Code: employeeCodeUpper });
    if (!employee) {
      return res.status(404).send({ error: "Employee not found with the given code." });
    }

    const { Name: name, Position: position } = employee;

    if (!td_format) td_format = 'MTD';
    if (!data_format) data_format = "value";

    // Parse start_date and end_date from request query in YYYY-MM-DD format
    let startDate = start_date ? new Date(start_date) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let endDate = end_date ? new Date(end_date) : new Date();

    startDate = new Date(startDate.toLocaleDateString('en-US'));
    endDate = new Date(endDate.toLocaleDateString('en-US'));

    const startYear = startDate.getFullYear();
    const startMonth = startDate.getMonth() + 1; // Month is zero-based
    const endYear = endDate.getFullYear();
    const endMonth = endDate.getMonth() + 1; // Month is zero-based
    const presentDayOfMonth = endDate.getDate();

    let matchStage = {
      parsedDate: {
        $gte: startDate,
        $lte: endDate
      },
      [position]: name
    };

    const result = {};

    if (td_format === 'MTD') {
      // Fetch current month (MTD) data
      const salesStats = await SalesDataMTDW.aggregate([
        {
          $addFields: {
            parsedDate: {
              $dateFromString: {
                dateString: "$DATE",
                format: "%m/%d/%Y",
                timezone: "UTC"
              }
            }
          }
        },
        { $match: matchStage }, // Match current month
        {
          $group: {
            _id: "$SALES TYPE",
            MTD_Value: { $sum: { $toInt: data_format === "value" ? "$MTD VALUE" : "$MTD VOLUME" } },
          }
        },
        {
          $project: {
            _id: 0,
            salesType: "$_id",
            MTD_Value: 1,
          }
        }
      ]);

      // Fetch last month's data (LMTD)
      let previousMonthStartDate = new Date(startDate);
      previousMonthStartDate.setMonth(previousMonthStartDate.getMonth() - 1);
      let previousMonthEndDate = new Date(endDate);
      previousMonthEndDate.setMonth(previousMonthEndDate.getMonth() - 1);

      const lastMonthSalesStats = await SalesDataMTDW.aggregate([
        {
          $addFields: {
            parsedDate: {
              $dateFromString: {
                dateString: "$DATE",
                format: "%m/%d/%Y",
                timezone: "UTC"
              }
            }
          }
        },
        { 
          $match: {
            parsedDate: { $gte: previousMonthStartDate, $lte: previousMonthEndDate },
            [position]: name
          }
        },
        {
          $group: {
            _id: "$SALES TYPE",
            LMTD_Value: { $sum: { $toInt: data_format === "value" ? "$MTD VALUE" : "$MTD VOLUME" } },
          }
        },
        {
          $project: {
            _id: 0,
            salesType: "$_id",
            LMTD_Value: 1,
          }
        }
      ]);

      // Error handling: if no data found, set LMTD_Value to 'N/A'
      let lmtDataMap = {};
      lastMonthSalesStats.forEach(item => {
        lmtDataMap[item.salesType] = item.LMTD_Value || 'N/A';
      });

      // Iterate through MTD data and append LMTD
      salesStats.forEach(item => {
        if (item.salesType === "Sell In" || item.salesType === "Sell Thru2") {
          result.td_sell_in = formatNumberIndian(item.MTD_Value);
          result.ltd_sell_in = lmtDataMap[item.salesType] !== 'N/A' ? formatNumberIndian(lmtDataMap[item.salesType]) : 'N/A';
          result.sell_in_growth = lmtDataMap[item.salesType] !== 'N/A' && lmtDataMap[item.salesType] !== 0
            ? (((item.MTD_Value - lmtDataMap[item.salesType]) / lmtDataMap[item.salesType]) * 100).toFixed(2) + '%'
            : 'N/A';
        } else if (item.salesType === "Sell Out") {
          result.td_sell_out = formatNumberIndian(item.MTD_Value);
          result.ltd_sell_out = lmtDataMap[item.salesType] !== 'N/A' ? formatNumberIndian(lmtDataMap[item.salesType]) : 'N/A';
          result.sell_out_growth = lmtDataMap[item.salesType] !== 'N/A' && lmtDataMap[item.salesType] !== 0
            ? (((item.MTD_Value - lmtDataMap[item.salesType]) / lmtDataMap[item.salesType]) * 100).toFixed(2) + '%'
            : 'N/A';
        }
      });
    }

    // For YTD
    if (td_format === 'YTD') {
      // Current Year YTD data
      const salesStats = await SalesDataMTDW.aggregate([
        {
          $addFields: {
            parsedDate: {
              $dateFromString: {
                dateString: "$DATE",
                format: "%m/%d/%Y",
                timezone: "UTC"
              }
            }
          }
        },
        {
          $match: {
            parsedDate: { $gte: new Date(`${endYear}-01-01`), $lte: endDate },
            [position]: name
          }
        },
        {
          $group: {
            _id: "$SALES TYPE",
            "YTD VALUE": { $sum: { $toInt: "$MTD VALUE" } }
          }
        }
      ]);

      // Last Year YTD data
      const lastYearSalesStats = await SalesDataMTDW.aggregate([
        {
          $addFields: {
            parsedDate: {
              $dateFromString: {
                dateString: "$DATE",
                format: "%m/%d/%Y",
                timezone: "UTC"
              }
            }
          }
        },
        {
          $match: {
            parsedDate: { $gte: new Date(`${endYear - 1}-01-01`), $lte: new Date(`${endYear - 1}-${endMonth}-${presentDayOfMonth}`) },
            [position]: name
          }
        },
        {
          $group: {
            _id: "$SALES TYPE",
            "LYTD VALUE": { $sum: { $toInt: "$MTD VALUE" } }
          }
        }
      ]);

      // Error handling for missing LYTD data
      let lastYearDataMap = {};
      lastYearSalesStats.forEach(item => {
        lastYearDataMap[item._id] = item['LYTD VALUE'] || 'N/A';
      });

      // Process and compare YTD and LYTD data
      salesStats.forEach(item => {
        if (item._id === 'Sell Out') {
          result.td_sell_out = exports.formatNumberIndian(item['YTD VALUE']);
          result.ltd_sell_out = lastYearDataMap[item._id] !== 'N/A' ? exports.formatNumberIndian(lastYearDataMap[item._id]) : 'N/A';
          result.sell_out_growth = lastYearDataMap[item._id] !== 'N/A' && lastYearDataMap[item._id] !== 0
            ? (((item['YTD VALUE'] - lastYearDataMap[item._id]) / lastYearDataMap[item._id]) * 100).toFixed(2) + '%'
            : 'N/A';
        } else {
          result.td_sell_in = exports.formatNumberIndian(item['YTD VALUE']);
          result.ltd_sell_in = lastYearDataMap[item._id] !== 'N/A' ? exports.formatNumberIndian(lastYearDataMap[item._id]) : 'N/A';
          result.sell_in_growth = lastYearDataMap[item._id] !== 'N/A' && lastYearDataMap[item._id] !== 0
            ? (((item['YTD VALUE'] - lastYearDataMap[item._id]) / lastYearDataMap[item._id]) * 100).toFixed(2) + '%'
            : 'N/A';
        }
      });
    }

    res.status(200).send(result);

  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Internal Server Error' });
  }
};

exports.getSalesDataChannelWiseForEmployeeMDTW = async (req, res) => {
  try {
    let { td_format, start_date, end_date, data_format, code } = req.query;

    if (!code) {
      return res.status(400).send({ error: "Employee code is required" });
    }

    // Convert employee code to uppercase
    const employeeCodeUpper = code.toUpperCase();

    // Fetch employee details based on the code
    const employee = await EmployeeCode.findOne({ Code: employeeCodeUpper });

    if (!employee) {
      return res.status(404).send({ error: "Employee not found with the given code" });
    }

    const { Name: name, Position: position } = employee;

    // Default channels and columns
    const channels = [
      "DCM", "PC", "SCP", "SIS Plus", "SIS PRO", "STAR DCM", "SES", "SDP", "RRF EXT", "SES-LITE"
    ];

    const defaultRow = {
      "Category Wise": "",
      "Target Vol": 0,
      "Mtd Vol": 0,
      "Lmtd Vol": 0,
      "Pending Vol": 0,
      "ADS": 0,
      "Req. ADS": 0,
      "% Gwth Vol": 0,
      "Target SO": 0,
      "Activation MTD": 0,
      "Activation LMTD": 0,
      "Pending Act": 0,
      "ADS Activation": 0,
      "Req. ADS Activation": 0,
      "% Gwth Val": 0,
      "FTD": 0,
      "Contribution %": 0
    };

    if (!name || !position) {
      return res.status(400).send({ error: "Name and position parameters are required" });
    }

    if (!td_format) td_format = 'MTD';

    let startDate = start_date ? new Date(start_date) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let endDate = end_date ? new Date(end_date) : new Date();

    const parseDate = (dateString) => {
      const [month, day, year] = dateString.split('/');
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`);
    };

    startDate = parseDate(startDate.toLocaleDateString('en-US'));
    endDate = parseDate(endDate.toLocaleDateString('en-US'));

    const presentDayOfMonth = new Date().getDate();

    // Fetch target values and volumes by channel
    const { targetValuesByChannel, targetVolumesByChannel } = await fetchTargetValuesAndVolumesByChannel(endDate, name, position);

    // Query for MTD data
    let salesStatsQuery = [
      {
        $addFields: {
          parsedDate: {
            $dateFromString: {
              dateString: "$DATE",
              format: "%m/%d/%Y",
              timezone: "UTC"
            }
          }
        }
      },
      {
        $match: {
          parsedDate: { $gte: startDate, $lte: endDate },
          "SALES TYPE": "Sell Out",
          [position]: name
        }
      },
      {
        $group: {
          _id: "$OLS TYPE",
          "MTD VALUE": { $sum: { $toInt: data_format === 'value' ? "$MTD VALUE" : "$MTD VOLUME" } },
          "TARGET VALUE": { $sum: { $toInt: data_format === 'value' ? "$TARGET VALUE" : "$TARGET VOLUME" } }
        }
      }
    ];

    const salesStats = await SalesDataMTDW.aggregate(salesStatsQuery);

    // Query for LMTD data
    let previousMonthStartDate = new Date(startDate);
    previousMonthStartDate.setMonth(previousMonthStartDate.getMonth() - 1);
    let previousMonthEndDate = new Date(endDate);
    previousMonthEndDate.setMonth(previousMonthEndDate.getMonth() - 1);

    const lastMonthSalesStats = await SalesDataMTDW.aggregate([
      {
        $addFields: {
          parsedDate: {
            $dateFromString: {
              dateString: "$DATE",
              format: "%m/%d/%Y",
              timezone: "UTC"
            }
          }
        }
      },
      {
        $match: {
          parsedDate: { $gte: previousMonthStartDate, $lte: previousMonthEndDate },
          "SALES TYPE": "Sell Out",
          [position]: name
        }
      },
      {
        $group: {
          _id: "$OLS TYPE",
          "LMTD VALUE": {
            $sum: {
              $convert: {
                input: data_format === 'value' ? "$MTD VALUE" : "$MTD VOLUME",
                to: "int",
                onError: 0,
                onNull: 0
              }
            }
          }
        }
      }
    ]);

    // Query for FTD data
    const ftdData = await SalesDataMTDW.aggregate([
      {
        $addFields: {
          parsedDate: {
            $dateFromString: {
              dateString: "$DATE",
              format: "%m/%d/%Y",
              timezone: "UTC"
            }
          }
        }
      },
      {
        $match: {
          parsedDate: endDate,
          "SALES TYPE": "Sell Out",
          [position]: name
        }
      },
      {
        $group: {
          _id: "$OLS TYPE",
          "FTD": {
            $sum: {
              $convert: {
                input: data_format === 'value' ? "$MTD VALUE" : "$MTD VOLUME",
                to: "int",
                onError: 0,
                onNull: 0
              }
            }
          }
        }
      }
    ]);

    // Build the report logic with all channels and include LMTD and FTD
    let lmtDataMap = {};
    let ftdDataMap = {};
    lastMonthSalesStats.forEach(item => {
      lmtDataMap[item._id] = item['LMTD VALUE'] || 0;
    });
    ftdData.forEach(item => {
      ftdDataMap[item._id] = item['FTD'] || 0;
    });

    let totalMTDSales = 0;
    let report = channels.map(channel => {
      let channelData = salesStats.find(item => item._id === channel) || {};
      let lmtValue = lmtDataMap[channel] || 0;
      let ftdValue = ftdDataMap[channel] || 0;

      let targetVol = targetVolumesByChannel[channel] || 0;
      let mtdVol = channelData['MTD VALUE'] || 0;
      let lmtdVol = lmtValue;

      totalMTDSales += mtdVol;

      let pendingVol = targetVol - mtdVol;
      let growthVol = lmtdVol !== 0 ? ((mtdVol - lmtdVol) / lmtdVol) * 100 : 0;
      let contribution = totalMTDSales !== 0 ? ((mtdVol / totalMTDSales) * 100).toFixed(2) : 0;

      return {
        "Category Wise": channel,
        "Target Vol": targetVol,
        "Mtd Vol": mtdVol,
        "Lmtd Vol": lmtdVol,
        "Pending Vol": pendingVol,
        "ADS": (mtdVol / presentDayOfMonth).toFixed(2),
        "Req. ADS": (pendingVol / (30 - presentDayOfMonth)).toFixed(2),
        "% Gwth Vol": growthVol.toFixed(2),
        "Target SO": targetValuesByChannel[channel] || 0,
        "Activation MTD": mtdVol,
        "Activation LMTD": lmtdVol,
        "Pending Act": pendingVol,
        "ADS Activation": (mtdVol / presentDayOfMonth).toFixed(2),
        "Req. ADS Activation": (pendingVol / (30 - presentDayOfMonth)).toFixed(2),
        "% Gwth Val": growthVol.toFixed(2),
        "FTD": ftdValue,
        "Contribution %": contribution
      };
    });

    // Grand total logic
    let grandTotal = report.reduce(
      (total, row) => {
        Object.keys(row).forEach(key => {
          if (key !== "Category Wise") total[key] += parseFloat(row[key]) || 0;
        });
        return total;
      },
      { ...defaultRow, "Category Wise": "Grand Total" }
    );

    grandTotal = {
      ...grandTotal,
      "ADS": (grandTotal["Mtd Vol"] / presentDayOfMonth).toFixed(2),
      "Req. ADS": (grandTotal["Pending Vol"] / (30 - presentDayOfMonth)).toFixed(2),
      "% Gwth Vol": ((grandTotal["Mtd Vol"] - grandTotal["Lmtd Vol"]) / grandTotal["Lmtd Vol"] * 100).toFixed(2),
      "ADS Activation": (grandTotal["Activation MTD"] / presentDayOfMonth).toFixed(2),
      "Req. ADS Activation": (grandTotal["Pending Act"] / (30 - presentDayOfMonth)).toFixed(2),
      "% Gwth Val": ((grandTotal["Activation MTD"] - grandTotal["Activation LMTD"]) / grandTotal["Activation LMTD"] * 100).toFixed(2)
    };

    report.unshift(grandTotal); // Insert the grand total as the first row


        // Add dynamic column names as the first entry in the response
        const columnNames = {
          "Category Wise": "Category Wise",
          "Target Vol": "Target Vol",
          "Mtd Vol": "Mtd Vol",
          "Lmtd Vol": "Lmtd Vol",
          "Pending Vol": "Pending Vol",
          "ADS": "ADS",
          "Req. ADS": "Req. ADS",
          "% Gwth Vol": "% Gwth Vol",
          "Target SO": "Target SO",
          "Activation MTD": "Activation MTD",
          "Activation LMTD": "Activation LMTD",
          "Pending Act": "Pending Act",
          "ADS Activation": "ADS Activation",
          "Req. ADS Activation": "Req. ADS Activation",
          "% Gwth Val": "% Gwth Val",
          "FTD": "FTD",
          "Contribution %": "Contribution %"
        };
    
        // Add the column names at the start of the report
        report.unshift(columnNames);

    res.status(200).send(report);
  } catch (error) {
    console.error(error);
    return res.status(500).send("Internal Server Error");
  }
};






