// DOTENV 
if (process.env.NODE_ENV !== 'production') {
require('dotenv').config({ path: '../.env' })
}
const Shopify = require('shopify-api-node');
const StormDB = require("stormdb");
const RateLimiter = require('limiter').RateLimiter;
const limiter = new RateLimiter(5, 250); // 5 request every 250ms ~ 20 per second
const connect = require('./mongodb');
var oxr = require('open-exchange-rates'),
fx = require('money');
oxr.set({ app_id: '1a3a29e313cf436bb5742412277c9a8c' })


const shopify = new Shopify({
shopName: process.env.shopName,
apiKey: process.env.shopKey,
password: process.env.shopPassword,
autoLimit: true
});

const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

const adapter = new FileSync('db.json')
const db = low(adapter)

const adapter2 = new FileSync('rates.json')
const rates = low(adapter2)

const shopify2 = new Shopify({
shopName: process.env.shopName2,
apiKey: process.env.shopKey2,
password: process.env.shopPassword2,
autoLimit: true
});

const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');
const url = 'mongodb+srv://admin_app:'+process.env.mongodb+'@cluster0.k4n0z.mongodb.net/myFirstDatabase?retryWrites=true&w=majority'; // Connection URL
const dbName = 'bijoux-medusa-db'; // Database Name

var mongo_db = null;
MongoClient.connect(url, function (err, client) {
if (err) { console.error(err) }
console.log('DATABASE: Connected successfully to DB --------!');
mongo_db = client.db(dbName) // once connected, assign the connection to the global variable
})

/*
setTimeout(() => {
mongo_db.collection('product_sync').deleteMany({})
}, 3000);
*/

function convertValues(v, base, curr) {
var database = rates.get('rates[0]').value();

var v = parseFloat(v);
var rate = parseFloat(database.rate); // pull rate
var value = v * rate;
value = value.toFixed(2)
return value
}

function roundRule(v) {
var amount = parseFloat(v);
var getLastDigit = num => +(num + '').slice(-2);
var decimals = getLastDigit(amount)

if (decimals == 99) {
    var amount = parseFloat(amount)
    return amount.toFixed(0)
} else {
    return amount.toFixed(2)
}
}

function parseProductHandle(handle) {
var handle = handle.replace(/-en-or-/g, '').replace(' ', '').toUpperCase(), // handle, remove 'en-or' from handle.
    prefix = 'BM'; // Prefix
handle = prefix + '-' + handle; // Set handle
return handle
}

function generateAllSku() {
(async () => {
    let params = { limit: 10, fields: 'handle,id,variants' }; // Set needed fields 
    do {
        const products = await shopify.product.list(params);
        products.forEach(function (product) { // sort through each product 
            limiter.removeTokens(1, function () {
                var handle = product.handle,  // grab handle
                    variants = product.variants, // grab variants
                    handleParse = parseProductHandle(handle); // generate SKU based on handle
                variants.forEach(function (variant) { // sort through each variant of the product
                    var idString = variant.id;
                    var getLastDigit = num => +(num + '').slice(-4);
                    var modifier = getLastDigit(idString)

                    var id = variant.id,
                        position = variant.position, // variant position for unique SKUs
                        generatedSku = handleParse + position + modifier;
                    let variantParams = { sku: generatedSku }; // update params

                    var today = new Date();
                    var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
                    var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
                    var dateTime = date + 'T' + time;

                    shopify.productVariant.update(id, variantParams).then(function (variant) {
                        console.log('Successfully updated SKU for ' + product.title + ' ' + variant.title)
                    }).catch((err) => {
                        console.log('FAILED to updated SKU for ' + product.title + ' ' + variant.title)
                    });
                });
            })
        });

        params = products.nextPageParameters;
    } while (params !== undefined);
})().catch(console.error);

shopify.on('callLimits', (limits) => console.log(limits));
}

function generateSingleSku(request) {
var handle = request.handle,  // grab handle
    variants = request.variants, // grab variants
    handleParse = parseProductHandle(handle);

variants.forEach(function (variant) { // sort through each variant of the product
    var idString = variant.id;
    var getLastDigit = num => +(num + '').slice(-4);
    var modifier = getLastDigit(idString)

    var id = variant.id,
        position = variant.position, // variant position for unique SKUs
        generatedSku = handleParse + position + modifier;

    var today = new Date();
    var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
    var dateTime = date + 'T' + time;

    let variantParams = { sku: generatedSku }; // update params
    console.log(generatedSku)
    shopify.productVariant.update(id, variantParams).then(function (variant) {
        var entry = { "variant_id": variant.id, "timestamp": dateTime, "status": true, "product_title": request.title, "variant_title": variant.title }
        connect.getDb().collection('sku-logs').insertOne(entry, function (error, response) {
            console.log('Successfully updated SKU for ' + request.title + ' ' + variant.title)
        })
    }).catch((err) => {
        var entry = { "variant_id": variant.id, "timestamp": dateTime, "status": false, "product_title": request.title, "variant_title": variant.title };
        connect.getDb().collection('sku-logs').insertOne(entry, function (error, response) {
            console.log('FAILED to updated SKU for ' + request.title + ' ' + variant.title)
        })
    });
});
}

function updateProduct(request) {
// We need to update the product on the new store. 
var main_variants = request.variants;

main_variants.forEach(function (variant) { // sort through each variant of the product
    var mainSku = variant.sku,
        mainCompare = variant.compare_at_price,
        mainPrice = variant.price,
        mainQuantity = variant.inventory_quantity;
    var param = {
        "sku": mainSku
    }

    console.log(param)

    shopify.product.list(param).then(function (product) {
        console.log(product.title)
    }).catch((err) => {

    })
})
}

function syncProducts() {
// We need to download products from one store, then migrate them to MongoDB AND then convert them and save them.

(async () => {
    let params = { limit: 1, fields: 'id,variants' }; // Set needed fields
    do {
        const products = await shopify.product.list(params);
        products.forEach(function (product) { // sort through each product
            limiter.removeTokens(1, function () {
                var main_product_id = product.id,
                    main_product_variants = product.variants;

                main_product_variants.forEach(function (variant) {
                    var variantPrice = parseInt(variant.price), // Price is formatted
                        variantCompare = 200;//variant.compare_at_price;

                    var CADtoUSD = async () => {
                        let amount = await convert(variantPrice, 'CAD', 'USD');
                        let compAmount = await convert(variantCompare, 'CAD', 'USD');
                        return [amount, compAmount]
                    };

                    CADtoUSD().then(function (converted_prices) {

                    })
                })

            })
        });

        params = products.nextPageParameters;
    } while (params !== undefined);
})().catch(console.error);

shopify.on('callLimits', (limits) => console.log(limits));
}

function convertPrice(request) { // Adjusted to use MongoDB for function

db.defaults({ products: [], user: {}, count: 0 }).write()
var found = db.get('products').find({ id: request.id }).value();

if (found) {
 // console.log('Already on scratch disk: ' + request.id) // Function will always trigger a second webhook. 
    var MINS = (60 * 3) * 1000; // 3 mins later remove so we don't trigger more webhooks.

    setTimeout(function () {
        db.get('products').remove({ id: request.id }).write()
        db.update('count', n => n - 1).write();
        console.log('Removed ' + request.id)

    }, MINS);

} else {
 //   console.log('Not found on scratch disk, proceed.') // Update the prices as needed, with the timer to remove the ID  
    request.variants.forEach(function (variant) {
        mongo_db.collection('product_sync').findOne({ 'sku': variant.sku }, function (err, query) {
            if (err) { console.error(err) }
        if (query) { // SHOULD NEVER NOT BE TRUE, Shopify sends webhook after we insert value into DB.
            var variant_id = variant.id,  mainCompare = parseFloat(query.compare_at_price), mainPrice = parseFloat(query.main_price);
            
            var CADtoUSD = async () => {
                var amount = convertValues(mainPrice, 'CAD', 'USD'); // CAD to USD
                var compareAmnt = convertValues(mainCompare, 'CAD', 'USD'); // CAD to USD
                var database = rates.get('rates[0]').value();
                var rate = database.rate;
                var results = {
                    "amount": amount,
                    "id": variant_id,
                    "compare": compareAmnt,
                    "rate": rate
                }
                return results
            };

            CADtoUSD().then(function (results) {
                var params = {}
                if (results.amount > 0) {
                    var vPrice = roundRule(results.amount);
                    params.price = parseFloat(vPrice);
                }

                if (results.compare > 0) {
                    var cPrice = roundRule(results.compare_at_price);
                    params.compare_at_price = parseFloat(cPrice);
                }

                limiter.removeTokens(1, function () {
                    shopify2.productVariant.update(results.id, params).then(function (variant) {
                        var title = variant.title,
                            variant_id = variant.id;
                            var message = 'STORE (US): Updated: ' + request.id + ' for variant ' + variant_id + ', converted ' + mainPrice + ' to ' + params.price + ' AND ' + mainCompare + ' to ' + params.compare_at_price;
                            console.log(message)
                    }).catch((err) => console.log('STORE (US): Product failed! ' + request.id + ' / variant: ' + variant_id));
                })

                db.get('products').push({ id: request.id, title: request.title }).write()
                db.update('count', n => n + 1).write();
            });
        }   
        });
    })
}
}

function convertAll() { // Convert all doesn't use Webhooks for now
(async () => {
    let params = { limit: 10, fields: 'handle,id,variants' }; // Set needed fields 
    do {
        const products = await shopify2.product.list(params);
        products.forEach(function (product) { // sort through each product 
            limiter.removeTokens(1, function () {
                var handle = product.handle,  // grab handle
                    variants = product.variants; // grab variants

                variants.forEach(function (variant) {
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
                        limiter.removeTokens(1, function () {
                            shopify2.productVariant.update(results.id, params).then(function (variant) {
                                var title = variant.title,
                                    variant_id = variant.id;
                                console.log('Updated ' + title + ' ID: ' + variant_id)
                            }).catch((err) => console.log(err));
                        })
                    });
                });
            })
        });

        params = products.nextPageParameters;
    } while (params !== undefined);
})().catch(console.error);

shopify.on('callLimits', (limits) => console.log(limits));

}

function convertAllUpdate() { // Used to update all the main store product. Also connects with MongoDB
(async () => {
    let params = { limit: 1, fields: 'title,handle,id,variants,updated_at,tags' }; // Set needed fields 
    do {
        const products = await shopify.product.list(params);
        products.forEach(function (product) { // sort through each product 
            limiter.removeTokens(1, function () {
                var handle = product.handle, variants = product.variants, id = product.id, prod = product.tags;
                console.log('STORE (CANADA): Success! Updated: ' + product.title + ' ... ' + product.id)

                if (prod.indexOf('priceUpdate') > -1) { prod = prod.replace(', priceUpdate', '') } else { var prod = prod + ', priceUpdate' }

                var params = {};
                params.tags = prod;
                shopify.product.update(id, params);

                variants.forEach(variant => {
                    mongo_db.collection('product_sync').findOne({ 'sku': variant.sku }, function (err, query) {
                        if (err) { console.error(err) }
                        var dbParams = { "product_id": product.id, "sku": variant.sku, "main_price": variant.price }
                        if (variant.compare_at_price > 0){ dbParams.compare_at_price = variant.compare_at_price}

                        if (query) {
                            mongo_db.collection('product_sync').updateOne({ 'sku': variant.sku }, { $set: { 'main_price': variant.price, 'compare_at_price': variant.compare_at_price } }, function (err, result) {
                                if (err) { console.error(err) }
                                console.log('DATABASE: Update price for ' + dbParams.sku);
                            });
                        } else {
                            mongo_db.collection('product_sync').insertOne(dbParams, function (err, result) {
                                if (err) { console.error(err) }
                                console.log('DATABASE: Created value for ' + dbParams.sku);
                            });
                        }
                    });
                });
            })
        });
        params = products.nextPageParameters;
    } while (params !== undefined);
})().catch(console.error)
    .then(function () {
        console.log('Finished entire product list')
    });

shopify.on('callLimits', (limits) => console.log(limits));

}

function updateRates() {
oxr.latest(function () {
    var base = 'CAD', conv = 'USD';

    fx.rates = oxr.rates;
    fx.base = oxr.base;
    var rate = fx(1.02).from(base).to(conv);
    rate = rate.toFixed(2);

    console.log('Current rate is: $' + rate)

    rates.get('rates')
        .find({ title: "current_rate" })
        .assign({ rate: rate })
        .write()
});
}

module.exports.syncProducts = syncProducts;
module.exports.updateProduct = updateProduct;
module.exports.generateSingleSku = generateSingleSku;
module.exports.generateAllSku = generateAllSku;
module.exports.convertAll = convertAll;
module.exports.convertPrice = convertPrice;
module.exports.convertPriceUpdate = convertAllUpdate;
module.exports.updateRate = updateRates;