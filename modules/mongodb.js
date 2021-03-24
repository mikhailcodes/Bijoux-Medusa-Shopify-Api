if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '../.env' })
}
const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');
const url = 'mongodb+srv://admin_app:' + process.env.mongodb + '@cluster0.k4n0z.mongodb.net/myFirstDatabase?retryWrites=true&w=majority';

var _db;

module.exports = {

  connectToServer: function( callback ) {
    MongoClient.connect( url,  { useNewUrlParser: true }, function( err, client ) {
      _db  = client.db('bijoux-medusa-db');
    } );
  },

  getDb: function() {
    return _db;
  }
};