-- Adiciona campo de prazo às tarefas de setor, necessário para criar o
-- evento correspondente no Outlook do responsável (um evento de calendário
-- precisa de uma data/hora — sem isso não há o que agendar).
ALTER TABLE tarefas_setor
  ADD COLUMN prazo TIMESTAMP;

COMMENT ON COLUMN tarefas_setor.prazo IS
  'Data/hora limite da tarefa. Usada para criar o evento no Outlook do responsável (ver outlookService.js). Opcional: se não informado, nenhum evento é criado.';
