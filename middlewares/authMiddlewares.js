const Role = require("../models/Role");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { SCOPES, oauth2Client } = require("../services/googleConfig");
require("dotenv").config();
const { JWT_SECRET } = process.env;

exports.userAuth = async (req, res, next) => {
  try {
    const token = req.header("Authorization");
    if (!token) {
      return res
        .status(401)
        .json({ error: "No token found, authorization denied" });
    }

    // Verify the token using your secret key
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ _id: decoded.user_id });

    if (!user) {
      return res.status(401).json({ error: "User not authorized" });
    }

    req.name = decoded.name;
    req.email = decoded.email;
    req.user_id = decoded.user_id;

    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.adminAuth = async (req, res, next) => {
  try {
    const { user_id } = req;
    const user = await User.findOne({ _id: user_id });

    const role = await Role.findOne({ _id: user.role });
    if (role.name !== "ADMIN")
      return res.status(401).send({
        error: "User is not admin",
      });

    next();
  } catch (error) {
    console.log(error);
    res.status(500).send({ error: "Internal Server Error" });
  }
};

exports.googleAuth = (req, res) => {
  try {
    const { token } = req.headers("Authorization");
    if (!token) {
      // Redirect the user to the OAuth 2.0 consent screen if not authenticated
      return res.redirect(
        oauth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES })
      );
    }

    oauth2Client.setCredentials(token);
    next();
  } catch (error) {
    console.log(error);
    res.status(500).send({ error: "Internal Server Error" });
  }
};
