const csvParser = require("csv-parser");
const { Readable } = require("stream");
const ModelData = require("../models/ModelData");
const SalesData = require("../models/SalesData");
const { getMonthFromDateExported } = require("../helpers/reportHelpers");
const { parseDate } = require("../helpers/salesHelpers");
const SalesDataMTDW = require("../models/SalesDataMTDW");
const EmployeeCode = require("../models/EmployeeCode");

exports.uploadModelData = async (req, res) => {
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
          .on("data", (data) => results.push(data))
          .on("end", async () => {
            try {
              // Insert data into MongoDB
              await ModelData.insertMany(results);
              res.status(200).send("Model Data inserted into database!");
            } catch (error) {
              console.log(error);
              res.status(500).send("Error inserting model data into database!");
            }
          });
      } else if (req.file.originalname.endsWith(".xlsx")) {
        // Parse XLSX file
        const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        results = xlsx.utils.sheet_to_json(sheet);
  
        try {
          // Insert data into MongoDB
          await ModelData.insertMany(results);
          res.status(200).send({
            message: "Data inserted successfully"
          });
        } catch (error) {
          console.log(error);
          res.status(500).send("Error inserting data into database");
        }
      } else {
        res.status(400).send("Unsupported file format");
      }
    } catch (error) {
      console.log(error);
      res.status(500).send("Internal server error");
    }
  };

// exports.getSalesDataModelWise = async (req, res) => {
//     try {
//       let { start_date, end_date } = req.query;
  
//       let startDate = start_date ? new Date(start_date) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
//       let endDate = end_date ? new Date(end_date) : new Date();
  
//       startDate = parseDate(startDate.toLocaleDateString('en-US'));
//       endDate = parseDate(endDate.toLocaleDateString('en-US'));
  
//       const currentMonth = endDate.getMonth() + 1;
//       const currentYear = endDate.getFullYear();
//       const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
//       const daysPassed = endDate.getDate();
  
//       // Fetch model data based on the first date of the month of endDate
//       const targetMonth = getMonthFromDateExported(endDate.toLocaleDateString('en-US'));
//       const [month, year] = targetMonth.split('/');
//       const targetStartDate = `${parseInt(month)}/1/${year}`;
  
//       const modelData = await ModelData.find({ 'START DATE': targetStartDate });
  
//       // Fetch sales data
//       const salesData = await SalesData.aggregate([
//         {
//           $addFields: {
//             parsedDate: {
//               $dateFromString: {
//                 dateString: "$DATE",
//                 format: "%m/%d/%Y",
//                 timezone: "UTC"
//               }
//             }
//           }
//         },
//         {
//           $match: {
//             "SALES TYPE": "Sell Out",
//             parsedDate: { $gte: startDate, $lte: endDate }
//           }
//         },
//         {
//           $group: {
//             _id: "$MARKET",
//             "MTD": { $sum: { $toInt: "$MTD VOLUME" } },
//             "LMTD": { $sum: { $toInt: "$LMTD VOLUME" } }
//           }
//         }
//       ]);
  
//       // Fetch FTD data separately
//       const ftdData = await SalesData.aggregate([
//         {
//           $addFields: {
//             parsedDate: {
//               $dateFromString: {
//                 dateString: "$DATE",
//                 format: "%m/%d/%Y",
//                 timezone: "UTC"
//               }
//             }
//           }
//         },
//         {
//           $match: {
//             "SALES TYPE": "Sell Out",
//             parsedDate: endDate
//           }
//         },
//         {
//           $group: {
//             _id: "$MARKET",
//             "FTD Vol": { $sum: { $toInt: "$MTD VOLUME" } }
//           }
//         }
//       ]);
  
//       // Combine data
//       const resultData = modelData.map(model => {
//         const modelName = model['MODEL NAME'];
//         const salesEntry = salesData.find(entry => entry._id === modelName) || {};
//         const ftdEntry = ftdData.find(entry => entry._id === modelName) || {};
  
//         const mtd = salesEntry.MTD || 0;
//         const lmtd = salesEntry.LMTD || 0;
//         const ftdVol = ftdEntry['FTD Vol'] || 0;
  
//         const averageDaySale = mtd / Math.max(daysPassed - 1, 1);
//         const dos = (parseInt(model['MKT STK']) + parseInt(model['DMDD STK'])) / averageDaySale;
  
//         return {
//           "Price Band": model['PRICE BAND'] || '',
//           "Market Name": model['MARKET NAME'] || '',
//           "MODEL NAME": modelName,
//           "Model Target": parseInt(model['MODEL TARGET']),
//           "LMTD": lmtd,
//           "MTD": mtd,
//           "FTD Vol": ftdVol,
//           "% Gwth": lmtd ? (((mtd - lmtd) / lmtd) * 100).toFixed(2) : "N/A",
//           "ADS": averageDaySale.toFixed(2),
//           "DP": model['DP'] || 0,
//           "Mkt Stk": parseInt(model['MKT STK']),
//           "Dmdd Stk": parseInt(model['DMDD STK']),
//           "M+S": parseInt(model['MKT STK']) + parseInt(model['DMDD STK']),
//           "DOS": dos.toFixed(2)
//         };
//       });
  
//       res.status(200).json(resultData);
//     } catch (error) {
//       console.error(error);
//       res.status(500).send("Internal Server Error");
//     }
//   };

exports.getSalesDataModelWise = async (req, res) => {
  try {
    let { start_date, end_date } = req.query;

    let startDate = start_date ? new Date(start_date) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let endDate = end_date ? new Date(end_date) : new Date();

    startDate = parseDate(startDate.toLocaleDateString('en-US'));
    endDate = parseDate(endDate.toLocaleDateString('en-US'));

    const currentMonth = endDate.getMonth() + 1;
    const currentYear = endDate.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const daysPassed = endDate.getDate();

    // Fetch model data based on the first date of the month of endDate
    const targetMonth = getMonthFromDateExported(endDate.toLocaleDateString('en-US'));
    const [month, year] = targetMonth.split('/');
    const targetStartDate = `${parseInt(month)}/1/${year}`;

    const modelData = await ModelData.find({ 'START DATE': targetStartDate });

    // Fetch sales data
    const salesData = await SalesData.aggregate([
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
          "SALES TYPE": "Sell Out",
          parsedDate: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: "$MODEL CODE",
          "MTD": { $sum: { $toInt: "$MTD VOLUME" } },
          "LMTD": { $sum: { $toInt: "$LMTD VOLUME" } },
          "Market Name": { $first: "$MARKET" },
          "Price Band": { $first: "$Segment New" }
        }
      }
    ]);

    // Fetch FTD data separately
    const ftdData = await SalesData.aggregate([
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
          "SALES TYPE": "Sell Out",
          parsedDate: endDate
        }
      },
      {
        $group: {
          _id: "$MODEL CODE",
          "FTD Vol": { $sum: { $toInt: "$MTD VOLUME" } }
        }
      }
    ]);

    // Combine data
    const resultData = modelData.map(model => {
      const modelName = model['MODEL NAME'];
      const salesEntry = salesData.find(entry => entry._id === modelName) || {};
      const ftdEntry = ftdData.find(entry => entry._id === modelName) || {};

      const mtd = salesEntry.MTD || 0;
      const lmtd = salesEntry.LMTD || 0;
      const ftdVol = ftdEntry['FTD Vol'] || 0;

      const averageDaySale = mtd / Math.max(daysPassed - 1, 1);
      const dos = (parseInt(model['MKT STK']) + parseInt(model['DMDD STK'])) / averageDaySale;

      return {
        "Price Band": salesEntry['Price Band'] || '',
        "Market Name": salesEntry['Market Name'] || '',
        "MODEL NAME": modelName,
        "Model Target": parseInt(model['MODEL TARGET']),
        "LMTD": lmtd,
        "MTD": mtd,
        "FTD Vol": ftdVol,
        "% Gwth": lmtd ? (((mtd - lmtd) / lmtd) * 100).toFixed(2) : "N/A",
        "ADS": averageDaySale.toFixed(2),
        "DP": model['DP'] || 0,
        "Mkt Stk": parseInt(model['MKT STK']),
        "Dmdd Stk": parseInt(model['DMDD STK']),
        "M+S": parseInt(model['MKT STK']) + parseInt(model['DMDD STK']),
        "DOS": dos.toFixed(2)
      };
    });

    res.status(200).json(resultData);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
};

exports.getSalesDataModelWiseForEmployeeMTDW = async (req, res) => {
  try {
    let { code } = req;
    let { start_date, end_date } = req.query;

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

    // Date handling logic
    let startDate = start_date ? new Date(start_date) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let endDate = end_date ? new Date(end_date) : new Date();

    const parseDate = (dateString) => {
      const [month, day, year] = dateString.split('/');
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`);
    };

    startDate = parseDate(startDate.toLocaleDateString('en-US'));
    endDate = parseDate(endDate.toLocaleDateString('en-US'));

    const currentMonth = endDate.getMonth() + 1;
    const currentYear = endDate.getFullYear();
    const daysPassed = endDate.getDate();

    // Fetch model data based on the first date of the month of endDate
    const targetMonth = `${currentMonth}/1/${currentYear}`;
    const modelData = await ModelData.find({ 'START DATE': targetMonth });

    // Query for MTD data (Sell Out only)
    const salesData = await SalesData.aggregate([
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
          _id: "$MODEL CODE",
          "MTD": { $sum: { $toInt: "$MTD VOLUME" } },
          "LMTD": { $sum: { $toInt: "$LMTD VOLUME" } },
          "Market Name": { $first: "$MARKET" },
          "Price Band": { $first: "$Segment New" }
        }
      }
    ]);

    // Query for LMTD data (previous month's data)
    let previousMonthStartDate = new Date(startDate);
    previousMonthStartDate.setMonth(previousMonthStartDate.getMonth() - 1);
    let previousMonthEndDate = new Date(endDate);
    previousMonthEndDate.setMonth(previousMonthEndDate.getMonth() - 1);

    const lastMonthSalesData = await SalesData.aggregate([
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
          _id: "$MODEL CODE",
          "LMTD": { $sum: { $toInt: "$MTD VOLUME" } }
        }
      }
    ]);

    // Fetch FTD data
    const ftdData = await SalesData.aggregate([
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
          "SALES TYPE": "Sell Out",
          parsedDate: endDate,
          [position]: name
        }
      },
      {
        $group: {
          _id: "$MODEL CODE",
          "FTD Vol": { $sum: { $toInt: "$MTD VOLUME" } }
        }
      }
    ]);

    // Combine unique models from both modelData and salesData
    const allModelNames = new Set([...modelData.map(model => model['MODEL NAME']), ...salesData.map(sale => sale._id)]);

    // Combine data
    let totalMTD = 0, totalLMTD = 0, totalFTDVol = 0, totalMktStk = 0, totalDmddStk = 0;
    const resultData = Array.from(allModelNames).map(modelName => {
      const model = modelData.find(m => m['MODEL NAME'] === modelName) || {};
      const salesEntry = salesData.find(entry => entry._id === modelName) || {};
      const lastMonthEntry = lastMonthSalesData.find(entry => entry._id === modelName) || {};
      const ftdEntry = ftdData.find(entry => entry._id === modelName) || {};

      const mtd = salesEntry.MTD || 0;
      const lmtd = lastMonthEntry.LMTD || 0;
      const ftdVol = ftdEntry['FTD Vol'] || 0;

      totalMTD += mtd;
      totalLMTD += lmtd;
      totalFTDVol += ftdVol;
      totalMktStk += parseInt(model['MKT STK'] || 0);
      totalDmddStk += parseInt(model['DMDD STK'] || 0);

      const averageDaySale = mtd / Math.max(daysPassed - 1, 1);
      const dos = (parseInt(model['MKT STK'] || 0) + parseInt(model['DMDD STK'] || 0)) / averageDaySale;

      return {
        "Price Band": salesEntry['Price Band'] || '',
        "Market Name": salesEntry['Market Name'] || '',
        "MODEL NAME": modelName,
        "Model Target": parseInt(model['MODEL TARGET'] || 0),
        "LMTD": lmtd,
        "MTD": mtd,
        "FTD Vol": ftdVol,
        "% Gwth": lmtd ? (((mtd - lmtd) / lmtd) * 100).toFixed(2) : "N/A",
        "ADS": averageDaySale.toFixed(2),
        "DP": model['DP'] || 0,
        "Mkt Stk": parseInt(model['MKT STK'] || 0),
        "Dmdd Stk": parseInt(model['DMDD STK'] || 0),
        "M+S": (parseInt(model['MKT STK'] || 0) + parseInt(model['DMDD STK'] || 0)),
        "DOS": dos.toFixed(2)
      };
    });

    // Calculate the grand total
    const grandTotal = {
      "Price Band": "",
      "Market Name": "",
      "MODEL NAME": "Grand Total",
      "Model Target": resultData.reduce((acc, row) => acc + parseInt(row["Model Target"] || 0), 0),
      "LMTD": totalLMTD,
      "MTD": totalMTD,
      "FTD Vol": totalFTDVol,
      "% Gwth": totalLMTD ? (((totalMTD - totalLMTD) / totalLMTD) * 100).toFixed(2) : "N/A",
      "ADS": (totalMTD / Math.max(daysPassed - 1, 1)).toFixed(2),
      "DP": resultData.reduce((acc, row) => acc + parseInt(row["DP"] || 0), 0),
      "Mkt Stk": totalMktStk,
      "Dmdd Stk": totalDmddStk,
      "M+S": totalMktStk + totalDmddStk,
      "DOS": ((totalMktStk + totalDmddStk) / (totalMTD / Math.max(daysPassed - 1, 1))).toFixed(2)
    };

    // Insert grand total as the first row
    resultData.unshift(grandTotal);

    // Add column names
    const columnNames = {
      "Price Band": "Price Band",
      "Market Name": "Market Name",
      "MODEL NAME": "MODEL NAME",
      "Model Target": "Model Target",
      "LMTD": "LMTD",
      "MTD": "MTD",
      "FTD Vol": "FTD Vol",
      "% Gwth": "% Gwth",
      "ADS": "ADS",
      "DP": "DP",
      "Mkt Stk": "Mkt Stk",
      "Dmdd Stk": "Dmdd Stk",
      "M+S": "M+S",
      "DOS": "DOS"
    };

    // Add column names as the first row
    resultData.unshift(columnNames);

    // Send the result
    res.status(200).json(resultData);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
};



