
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: '../.env' })
}
const connect = require('./mongodb')
const client = connect.getDb();

var serverFunc = {
    /// MongoDB save one record.
    mongoSave: function (database, json) {
        client.collection(database).insertOne(json, function (error, response) {
            if (error) {
                console.log('Error occurred while saving ' + json.id);
            } else {
                console.log('Saved record for ' + json.id);
            }
        })
    },
    /// MongoDB save MANY records.
    mongoSaveMany: function (database, json) {
        client.collection(database).insertMany([json], function (error, response) {
            if (error) {
                console.log('Error occurred while saving ' + json.id);
            } else {
                console.log('Saved record for ' + json.id);
            }
        })

    },
    /// MongoDB update record.
    mongoUpdate: function (database, json) {
        client.collection(database).updateOne({ a: 2 }, { $set: { b: 1 } }, function (err, result) {
            assert.equal(err, null);
            assert.equal(1, result.result.n);
            console.log("Updated the document with the field a equal to 2");

        });
    },
    /// MongoDB fetch record.
    mongoFetch: function (database) {
        connect.getDb().collection(database).find().toArray(function (err, results) {
        console.log(results)
        return results
        })
    }
}

module.exports = serverFunc;
