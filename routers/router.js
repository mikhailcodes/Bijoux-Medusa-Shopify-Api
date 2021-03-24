/* 
Main Router File 
*/
const appRoutes = require('express').Router();
const apiRoutes = require('./apiRouters');
const mainRoutes = require('./mainRouters.js');

//  Connect all our routes to our application
appRoutes.use('/api', apiRoutes);
appRoutes.use('/admin', mainRoutes);
appRoutes.get('/', function(req, res) {
    res.redirect('/admin' );
})


module.exports = appRoutes;
