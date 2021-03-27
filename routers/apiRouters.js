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
  password: process.env.shopPassword2
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


apiRoutes.route('/convert').post(function (req, res) {
  // Client is using Syncio Shopify App for their constant sync of their products. 
  // Syncio sends the price without converting. Eg: if CAD Price is $19.99, it gets sent to USD site as $19.99
  // Syncio triggers a product update webhook which we send to our server.
  // We then update the product price by converting it here.
  // Unfortunately our update ALSO triggers a webhook after we update. So we will maintain a 'scratch disk' for 20seconds in this DB
  // If we find another way, we'll update it.


  db.defaults({ products: [], user: {}, count: 0 }).write()

  var request = req.body;
  res.send('Recieved!')

  var found = db.get('products').find({ id: request.id }).value();

  if (found) {
    // Function will always trigger a second webhook, so on the second we remove it.
    console.log('Already on scratch disk: ' + request.id)
   
      db.get('products').remove({ id: request.id }).write()
      db.update('count', n => n - 1).write();
      console.log('Removed ' + request.id)

  } else {
    console.log('Not found on scratch disk, proceed.')
    // Update the prices as needed, with the timer to remove the ID 
  
    request.variants.forEach(function (variant) {
      var variant_id = variant.id,
        mainCompare = parseFloat(variant.compare_at_price),
        mainPrice = parseFloat(variant.price);

      var CADtoUSD = async () => {
        var amount = await convert(mainPrice, 'CAD', 'USD'); // CAD to USD
        var compareAmnt = await convert(mainCompare, 'CAD', 'USD'); // CAD to USD
        var results = {
          "amount": amount,
          "id": variant_id,
          "compare": compareAmnt
        }
        return results
      };

      CADtoUSD().then(function (results) {
        var params = {}
        if (results.amount > 0) { params.price = results.amount.toFixed(2) }
        if (results.compare > 0) { params.compare_at_price = results.compare.toFixed(2) }
        var message = 'For ' + request.title + ' variant: ' + variant_id + ', converted ' + mainPrice + ' / ' + mainCompare + ' to ' + params.price + ' / ' + params.compare_at_price;
        console.log(message) // Message will show NaN/Undefined if the value is zero. This is intended.

        limiter.removeTokens(1, function () {
          shopify2.productVariant.update(results.id, params).then(function (variant) {
            var title = variant.title,
              variant_id = variant.id;
            console.log('Updated ' + title + ' ID: ' + variant_id)
          }).catch((err) => console.log(err));
        })
      });
    })
    db.get('products').push({ id: request.id, title: request.title }).write()
    db.update('count', n => n + 1).write();
    console.log('Saved product: ' + request.id)

/*
    setTimeout(function () {
      db.get('posts').remove({ id: request.id, title: request.title }).write()
      db.update('count', n => n - 1).write();
      console.log('Removed ' + request.id)
    }, 8000);
    */
  }


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