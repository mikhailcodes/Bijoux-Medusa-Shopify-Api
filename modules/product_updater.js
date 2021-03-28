// DOTENV 
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: '../.env' })
}
const Shopify = require('shopify-api-node');
const StormDB = require("stormdb");
const sku_generator = new StormDB.localFileEngine("db/dbb.sku_generator");
const { convert } = require('exchange-rates-api');
const { exchangeRates } = require('exchange-rates-api');
const RateLimiter = require('limiter').RateLimiter;
const limiter = new RateLimiter(5, 250); // 5 request every 250ms ~ 20 per second

const connect = require('./mongodb');

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

const shopify2 = new Shopify({
  shopName: process.env.shopName2,
  apiKey: process.env.shopKey2,
  password: process.env.shopPassword2
});

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
                        var id = variant.id,
                            position = variant.position, // variant position for unique SKUs
                            generatedSku = handleParse + position;
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
        var id = variant.id,
            position = variant.position, // variant position for unique SKUs
            generatedSku = handleParse + position;

        var today = new Date();
        var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
        var dateTime = date + 'T' + time;

        let variantParams = { sku: generatedSku }; // update params
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

function convertPrice(request) {
    // Client is using Syncio Shopify App for their constant sync of their products. 
    // Syncio sends the price without converting. Eg: if CAD Price is $19.99, it gets sent to USD site as $19.99
    // Syncio triggers a product update webhook which we send to our server.
    // We then update the product price by converting it here.
    // Unfortunately our update ALSO triggers a webhook after we update. So we will maintain a 'scratch disk' for 20seconds in this DB
    // If we find another way, we'll update it.

    db.defaults({ products: [], user: {}, count: 0 }).write()
    var found = db.get('products').find({ id: request.id }).value();

    if (found) {
        console.log('Already on scratch disk: ' + request.id) // Function will always trigger a second webhook, so on the second we remove it.
        db.get('products').remove({ id: request.id }).write()
        db.update('count', n => n - 1).write();
        console.log('Removed ' + request.id)
    } else {
        console.log('Not found on scratch disk, proceed.') // Update the prices as needed, with the timer to remove the ID 
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
    }

}

function convertAll() {
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
                            var message = 'For variant: ' + variant_id + ', converted ' + mainPrice + ' / ' + mainCompare + ' to ' + params.price + ' / ' + params.compare_at_price;
                            console.log(message) // Message will show NaN/Undefined if the value is zero. This is intended.

                   
                                shopify2.productVariant.update(results.id, params).then(function (variant) {
                                    var title = variant.title,
                                        variant_id = variant.id;
                                    console.log('Updated ' + title + ' ID: ' + variant_id)
                                }).catch((err) => console.log(err));
                        
                        });
                    });
                })
            });

            params = products.nextPageParameters;
        } while (params !== undefined);
    })().catch(console.error);

    shopify.on('callLimits', (limits) => console.log(limits));

}

module.exports.syncProducts = syncProducts;
module.exports.updateProduct = updateProduct;
module.exports.generateSingleSku = generateSingleSku;
module.exports.generateAllSku = generateAllSku;
module.exports.convertAll = convertAll;
module.exports.convertPrice = convertPrice;