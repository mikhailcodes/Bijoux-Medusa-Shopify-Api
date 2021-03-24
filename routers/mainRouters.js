const mainRoutes = require('express').Router();
const RateLimiter = require('limiter').RateLimiter;
const limiter = new RateLimiter(5, 250); // 5 request every 250ms ~ 20 per second
const passport = require('passport');
const Strategy = require('passport-local').Strategy;
// DATABASES - SKU Generated, Settings, Currency
const db = require('../db');
const StormDB = require("stormdb");
const sku_generator = new StormDB.localFileEngine("db/dbb.sku_generator");
const sku_db = new StormDB(sku_generator);
const settings_ = new StormDB.localFileEngine("db/dbb.settings");
const settings_db = new StormDB(settings_);
const currency_ = new StormDB.localFileEngine("db/dbb.currency");
const currency_db = new StormDB(currency_);

// DOTENV 
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({path:'../.env'})
}
const Shopify = require('shopify-api-node');
const shopify = new Shopify({
  shopName: process.env.shopName,
  apiKey: process.env.shopKey,
  password: process.env.shopPassword,
  autoLimit: true
});

// Config Settings 
const userSettings = settings_db.get("settings").get(0).value();

// PASSPORT JS
passport.use(new Strategy(
  function (username, password, cb) {
    db.users.findByUsername(username, function (err, user) {
      if (err) { return cb(err); }
      if (!user) { return cb(null, false); }
      if (user.password != password) { return cb(null, false); }
      return cb(null, user);
    });
  }));

passport.serializeUser(function (user, cb) {
  cb(null, user.id);
});


passport.deserializeUser(function (id, cb) {
  db.users.findById(id, function (err, user) {
    if (err) { return cb(err); }
    cb(null, user);
  });
});


mainRoutes.use(passport.initialize());
mainRoutes.use(passport.session());

// Define routes.
mainRoutes.get('/',
  function (req, res) {
    
    res.render('login', { user: req.user });
  });

mainRoutes.get('/login',
  function (req, res) {
    res.render('login');
  });

  mainRoutes.post('/login', function (req, res, next) {
  passport.authenticate('local', function (err, user, info) {
    if (err) {
      return next(err); // will generate a 500 error
    }
    if (!user) {
      return res.redirect('/admin/login?failed_auth');
    }
    req.login(user, function (err) {
      if (err) {
        return next(err);
      }
      return res.redirect('/admin/dashboard');
    });
  })(req, res, next);

});

mainRoutes.get('/logout',
  function (req, res) {
    req.logout();
    res.redirect('/');
  });

  mainRoutes.get('/dashboard',
  require('connect-ensure-login').ensureLoggedIn(),
  function (req, res) {
    res.render('dashboard', { user: req.user });
  });
  
  
  mainRoutes.get('/settings',
  require('connect-ensure-login').ensureLoggedIn(),
  function (req, res) {
    res.render('settings', { user: req.user });
  });
  
  mainRoutes.get('/currency',
  require('connect-ensure-login').ensureLoggedIn(),
  function (req, res) {
    res.render('settings', { user: req.user });
  });

  mainRoutes.get('/sku', require('connect-ensure-login').ensureLoggedIn(),
  function (req, res) {
  var sku_array = sku_db.get("generated").value();
    res.render('sku-generator', { user: req.user, sku: sku_array });
    
  });

 
module.exports = mainRoutes;