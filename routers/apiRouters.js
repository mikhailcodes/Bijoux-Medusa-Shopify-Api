if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '../.env' })
}
const apiRoutes = require('express').Router();
const RateLimiter = require('limiter').RateLimiter;
const limiter = new RateLimiter(5, 250); // 5 request every 250ms ~ 20 per second
const connect = require('../modules/mongodb')
const ObjectId = require('mongodb').ObjectID;
const Shopify = require('shopify-api-node');
const shopify = new Shopify({
  shopName: process.env.shopName,
  apiKey: process.env.shopKey,
  password: process.env.shopPassword
});

const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

const adapter = new FileSync('db.json')
const db = low(adapter)

const shopify2 = new Shopify({
  shopName: process.env.shopName2,
  apiKey: process.env.shopKey2,
  password: process.env.shopPassword2,
  autoLimit: true
});
const product_updater = require('../modules/product_updater')
const { convert } = require('exchange-rates-api');
const { exchangeRates } = require('exchange-rates-api');

//Configure the settings of the apiRoutes
shopify.on('callLimits', (limits) => console.log(limits));

// Fetch the stored DB settings
apiRoutes.get('/fetchsettings', function (req, res) {
  var database = 'Settings';
  connect.getDb().collection(database).find().toArray(function (err, results) {
    res.send(results)
  })
});

// Updates the DB settings
apiRoutes.post('/settings', function (req, res) {
  var database = 'Settings';
  var request = req.body; // this will explain the setting type that we need to update
  var settings = request.settings, type = request.settings_type;
  var dataset = {}
  dataset[type] = settings

  connect.getDb().collection(database).find().toArray(function (err, docs) {
    var id = docs[0]._id;
    connect.getDb().collection(database).updateOne({ "_id": ObjectId(id) }, { $set: dataset }, function (err, result) {
      console.log('done')
    });
    res.send('Updated!')
  });
})

// Generate single SKUs, uses product UPDATE and product CREATE webhooks.
apiRoutes.post('/generate_sku', function (req, res) {
  var request = req.body;
  product_updater.generateSingleSku(request)
  res.send('Recieved')
})

// Triggered by the admin on the dashboard. Will take a while but will add SKU to ALL products.
apiRoutes.post('/update_all_sku', function (req, res) {
  product_updater.generateAllSku()
  res.send('Recieved')
})

apiRoutes.post('/convert_all_usd', function (req, res) {
  product_updater.convertAll()
  res.send('Recieved')
})

apiRoutes.get('/triggerMain', function (req, res) {
  product_updater.convertPriceUpdate()
  res.send('Recieved')
})

apiRoutes.route('/update_rates').post(function (req, res) {
  var request = req.body;
  product_updater.updateRate()
  res.send('Recieved!')
});

apiRoutes.route('/update_rates').get(function (req, res) {
  var request = req.body;
  product_updater.updateRate()
  res.send('Recieved!')
});


apiRoutes.route('/convert').post(function (req, res) {
  var request = req.body;
  product_updater.convertPrice(request)
  res.send('Recieved!')
});

apiRoutes.route('/inventory').post(function (req, res) {
  var inventoryID = req.body.inventoryID;

  limiter.removeTokens(1, function () {
    var id = inventoryID;
    var params = { inventory_item_ids: inventoryID } // item inventory id
    shopify.inventoryLevel.list(params).then(function (inventoryLevel) {
      res.send(inventoryLevel)
    })
      .catch((err) => res.status(err.response.statusCode).json(err));
  })
});

apiRoutes.route('/location').post(function (req, res) {
  limiter.removeTokens(1, function () {
    shopify.location
      .list()
      .then((result) => res.json(result))
      .catch((err) => res.status(400).json(err));
  });
});

apiRoutes.route('/product').post(function (req, res) {
  var productId = req.body.product;
  limiter.removeTokens(1, function () {
    shopify.product
      .get(productId)
      .then((result) => res.json(result))
      .catch((err) => res.status(400).json(err));
  });
});

apiRoutes.route('/test').post(function (req, res) {
  var productId = req.body.product;

  limiter.removeTokens(1, function () {
    shopify.inventoryItem
      .get(41367669047385)
      .then((result) => res.json(result))
      .catch((err) => res.status(400).json(err));
  });
});

module.exports = apiRoutes;