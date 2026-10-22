const express = require('express');
const router = express.Router();
const Notificacao = require('../models/Notificacao');
const { autenticar } = require('../middlewares/auth');
const { AppError } = require('../middlewares/errorHandler');

// Avisos do "sininho" — cada colaborador só vê e mexe nos próprios.
router.use(autenticar);

router.get('/', async (req, res, next) => {
  try {
    res.json(await Notificacao.listar(req.usuario.id, 20));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/lida', async (req, res, next) => {
  try {
    const ok = await Notificacao.marcarLida(req.params.id, req.usuario.id);
    if (!ok) throw new AppError('Aviso não encontrado.', 404);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post('/marcar-todas-lidas', async (req, res, next) => {
  try {
    await Notificacao.marcarTodasLidas(req.usuario.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
