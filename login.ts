const mysql = require("mysql");
const express = require("express");
const session = require("express-session");
const path = require("path");
const dotenv = require("dotenv");
const twilio = require("twilio");

dotenv.config();

const connection = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "nodelogin",
});

const app = express();

const accountSid = process.env.twilio_Sid;
const authToken = process.env.twilio_authToken;
const client = require("twilio")(accountSid, authToken);

app.use(
    session({
        secret: "secret",
        resave: true,
        saveUninitialized: true,
    })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "static")));

// http://localhost:3000/
app.get("/", function (request, response) {
    response.sendFile(path.join(__dirname + "/login.html"));
});

// http://localhost:3000/2fa
app.get("/2fa", function (request, response) {
    response.sendFile(path.join(__dirname + "/2fa.html"));
});

// http://localhost:3000/home
app.get("/home", function (request, response) {
    // If the user is loggedin
    if (request.session.loggedin) {
        response.sendFile(path.join(__dirname + "/home.html"));
    } else {
        // Not logged in
        response.send("Please login to view this page!");
        response.end();
    }
});

// http://localhost:3000/update
app.post("/update", function (request, response) {
    const inputName = request.body.name;
    const inputMail = request.body.mail;
    const oldName = request.session.name;
    const oldMail = request.session.mail;
    let newName, newMail;

    if (inputName) {
        newName = inputName;
    } else {
        newName = oldName;
    }
    if (inputMail) {
        newMail = inputMail;
    } else {
        newMail = oldMail;
    }

    const id = request.session.SQLid;
    request.session.name = newName;
    request.session.mail = newMail;
    connection.query(
        "UPDATE bling_accounts SET name = ?, mail = ? WHERE id = ?;",
        [newName, newMail, id],
        function (error, results, fields) {
            if (error) throw error;
            response.redirect("/home");
        }
    );
});

// http://localhost:3000/update-password
app.post("/update-password", function (request, response) {
    request.session.changePassword = true;
    request.session.newPassword = request.body.password;
    const code = generateCode();
    request.session.code = code;
    client.messages
        .create({
            body: "Here is your login code: " + code,
            to: request.session.mobile,
            from: process.env.twilio_number,
        })
        .then((message) => console.log(message.sid));
    // Render 2fa template
    response.sendFile(path.join(__dirname + "/2fa.html"));
});

// http://localhost:3000/auth
app.post("/auth", function (request, response) {
    // Capture the input fields
    const name = request.body.name;
    const password = request.body.password;
    const mail = request.body.mail;
    const mobile = request.body.mobile;
    const submitType = request.body.submit;

    if (submitType === "Register") {
        // Register
        if (name && password && mail && mobile) {
            connection.query(
                "INSERT INTO bling_accounts (name, password, mail, mobile) VALUES (?, ?, ?, ?);",
                [name, password, mail, mobile],
                function (error, result, fields) {
                    if (error) throw error;
                    request.session.loggedin = true;
                    request.session.name = name;
                    request.session.mail = mail;
                    request.session.mobile = mobile;
                    request.session.password = password;
                    request.session.SQLid = result.insertId;
                    response.redirect("/home");
                }
            );
        } else {
            response.send("Please enter all fields to register!");
            response.end();
        }
    } else {
        // Login
        if (name && password) {
            connection.query(
                "SELECT * FROM bling_accounts WHERE name = ? AND password = ?",
                [name, password],
                function (error, results, fields) {
                    if (error) throw error;
                    if (results.length > 0) {
                        // Account exists
                        request.session.SQLid = results[0].id;
                        request.session.loggedin = true;
                        request.session.username = name;
                        response.redirect("/home");
                    } else {
                        response.send("Incorrect Username and/or Password!");
                        response.end();
                    }
                }
            );
        } else {
            // incorrect name and password
            response.send("Please enter a valid Name and Password!");
            response.end();
        }
    }
});

// http://localhost:3000/auth-2fa
app.post("/auth-2fa", function (request, response) {
    const code = request.body.code;
    if (code === request.session.code) {
        // code correct
        if (request.session.changePassword) {
            // for password change
            const newPassword = request.session.newPassword;
            const id = request.session.SQLid;
            request.session.password = newPassword;
            connection.query(
                "UPDATE bling_accounts SET password = ? WHERE id = ?;",
                [newPassword, id],
                function (error, results, fields) {
                    if (error) throw error;
                    response.redirect("/home");
                }
            );
        } else {
            // for logging in
            request.session.loggedin = true;
            response.redirect("/home");
        }
    } else {
        response.send("Wrong Code!");
        response.end();
    }
});

// http://localhost:3000/code
app.post("/code", function (request, response) {
    let name = request.body.name;
    let mobile = request.body.mobile;
    const password = request.body.password;
    // Ensure the input fields exists and are not empty
    if ((mobile || name) && password) {
        let queryString, inputs;
        if (mobile) {
            queryString =
                "SELECT * FROM bling_accounts WHERE mobile = ? AND password = ?";
            inputs = [mobile, password];
        } else {
            queryString =
                "SELECT * FROM bling_accounts WHERE name = ? AND password = ?";
            inputs = [name, password];
        }
        connection.query(
            queryString,
            inputs,
            function (error, results, fields) {
                if (error) throw error;
                if (results.length > 0) {
                    let id = results[0].id;
                    name = results[0].name;
                    mobile = results[0].mobile;
                    request.session.SQLid = id;
                    request.session.name = name;
                    request.session.mobile = mobile;

                    const code = generateCode();
                    request.session.code = code;
                    client.messages
                        .create({
                            body: "Here is your login code: " + code,
                            to: mobile, // process.env.my_number,
                            from: process.env.twilio_number,
                        })
                        .then((message) => console.log(message.sid));
                    response.redirect("/2fa");
                } else {
                    response.send(
                        "Incorrect Mobile/Mobile and Password combination!"
                    );
                }
                response.end();
            }
        );
    } else {
        response.send("Please enter your Password and either Name or Mobile!");
        response.end();
    }
});

function generateCode() {
    const numbers = Array.from(Array(6)).map((_) =>
        Math.floor(Math.random() * 10)
    );
    return numbers.join("");
}

app.listen(3000);
