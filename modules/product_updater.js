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

// Private keys for non-customer-facing API


const shopify = new Shopify({
    shopName: process.env.shopName,
    apiKey: process.env.privateKey,
    password: process.env.privatePassword,
    autoLimit: true
});

const shopify_two = new Shopify({
    shopName: process.env.shopName_two,
    apiKey: process.env.privateKey_two,
    password: process.env.privatePassword_two,
    autoLimit: true
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

    // Search for the parallel product on second store

    // Update parallel product
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
                            return [amount,compAmount]      
                        };

                        CADtoUSD().then(function(converted_prices) { 
                        
                        })
                    })

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