// Script d'envoi des rapports de veille, à coller dans script.google.com (compte veilleursviral@gmail.com)
const JETON = 'COLLER_ICI_LE_JETON';
function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  if (d.jeton !== JETON) return ContentService.createTextOutput('refusé');
  const m = { to: d.to.join(','), subject: d.subject, body: d.text, name: 'Veille e-réputation Viral' };
  if (d.b64) m.attachments = [Utilities.newBlob(Utilities.base64Decode(d.b64), 'application/pdf', d.filename)];
  MailApp.sendEmail(m);
  return ContentService.createTextOutput('ok');
}
function testerAutorisation() { Logger.log('Quota restant aujourd\'hui : ' + MailApp.getRemainingDailyQuota()); }
