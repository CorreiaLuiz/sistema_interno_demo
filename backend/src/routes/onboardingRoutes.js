const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboardingController');
const { autenticar } = require('../middlewares/auth');

router.use(autenticar);

router.get('/:empresaId', onboardingController.buscar);
router.post('/:empresaId/avancar', onboardingController.avancar);

module.exports = router;
