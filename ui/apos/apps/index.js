export default () => {
  let ready = false;

  apos.util.onReady(() => {
    if (!ready) {
      ready = true;
      apos.bus.$on('export-download', openUrl);
      apos.bus.$on('import-started', addBeforeUnloadListener);
      apos.bus.$on('import-ended', removeBeforeUnloadListener);
      apos.bus.$on('import-duplicates', handleDuplicates);
    }
  });

  function openUrl(event) {
    if (event.url) {
      window.location.assign(event.url);
    }
  }

  function addBeforeUnloadListener() {
    window.addEventListener('beforeunload', warningImport);
  }

  function removeBeforeUnloadListener() {
    window.removeEventListener('beforeunload', warningImport);
  }

  async function handleDuplicates(event) {
    if (event.duplicatedDocs.length) {
      await apos.modal.execute('AposDuplicateImportModal', event);
    }
  }

  function warningImport(event) {
    event.preventDefault();
    event.returnValue = '';
  }
};
