const path = require('path');
const fsp = require('node:fs/promises');
const { cloneDeep } = require('lodash');
const { EJSON } = require('bson');

module.exports = self => {
  return {
    async import(req, moduleName) {
      const {
        docs, attachmentsInfo, exportPath, filePath
      } = await self.readExportFile(req);
      if (!req.user) {
        throw self.apos.error('forbidden');
      }

      const total = docs.length + attachmentsInfo.length;
      const {
        reporting, jobId, notificationId
      } = await self.instantiateJob(req, total);

      const {
        duplicatedDocs, duplicatedIds, failedIds
      } = await self.insertDocs(req, docs, reporting);
      const importedAttachments = await self.insertAttachments(req, {
        attachmentsInfo,
        reporting,
        duplicatedIds,
        docIds: new Set(docs.map(({ aposDocId }) => aposDocId))
      });

      if (!duplicatedDocs.length) {
        await reporting.end();

        const notifMsg = `aposImportExport:${
          failedIds.length ? 'importFailedForSome' : 'importSucceed'}`;

        await self.apos.notify(req, notifMsg, {
          interpolate: {
            count: failedIds.length
          },
          dismiss: true,
          icon: 'database-import-icon',
          type: failedIds.length ? 'danger' : 'success',
          event: {
            name: 'import-ended'
          }
        });

        self.apos.notification.dismiss(req, notificationId, 2000)
          .catch((error) => {
            self.apos.util.error(error);
          });

        await self.cleanFile(exportPath);
        await self.cleanFile(filePath);
        return;
      }

      if (failedIds.length) {
        await self.apos.notify(req, 'aposImportExport:importFailedForSome', {
          interpolate: {
            count: failedIds.length
          },
          dismiss: true,
          icon: 'database-import-icon',
          type: 'danger'
        });
      }

      const results = {
        duplicatedDocs,
        importedAttachments,
        type: moduleName,
        exportPath,
        jobId,
        notificationId
      };

      await self.apos.notify(req, 'aposImportExport:importDuplicateDetected', {
        icon: 'database-import-icon',
        type: 'warning',
        event: {
          name: 'import-duplicates',
          data: results
        }
      });

      self.cleanFile(filePath);

      return results;
    },

    async instantiateJob(req, total) {
      const jobManager = self.apos.modules['@apostrophecms/job'];
      const job = await jobManager.start();

      const { noteId } = await self.apos.notify(req, 'aposImportExport:importing', {
        icon: 'database-import-icon',
        type: 'success',
        job: {
          _id: job._id
        },
        return: true
      });

      await jobManager.setTotal(job, total);

      return {
        reporting: {
          success(n) {
            return jobManager.success(job, n);
          },
          failure(n) {
            return jobManager.failure(job, n);
          },
          end(success = true) {
            return jobManager.end(job, success);
          }
        },
        jobId: job._id,
        notificationId: noteId
      };
    },

    async readExportFile(req) {
      const { file } = req.files || {};

      if (!file) {
        throw self.apos.error('invalid');
      }

      const format = Object
        .values(self.formats)
        .find((format) => format.allowedTypes.includes(file.type));

      if (!format) {
        throw self.apos.error('invalid');
      }

      try {
        const exportPath = await format.input(file.path);

        return {
          ...await self.getFilesData(exportPath),
          filePath: file.path
        };
      } catch (error) {
        await self.apos.notify(req, 'aposImportExport:importFileError', {
          interpolate: { format: format.label },
          dismiss: true,
          icon: 'alert-circle-icon',
          type: 'danger'
        });
        throw self.apos.error(error.message);
      }
    },

    async getFilesData(exportPath, docIds) {
      const docs = await fsp.readFile(path.join(exportPath, 'aposDocs.json'));
      const attachments = await fsp.readFile(path.join(exportPath, 'aposAttachments.json'));

      return {
        docs: !docIds
          ? EJSON.parse(docs)
          : EJSON.parse(docs).filter(({ aposDocId }) => docIds.includes(aposDocId)),
        attachmentsInfo: EJSON.parse(attachments).map((attachment) => ({
          attachment,
          file: {
            name: `${attachment.name}.${attachment.extension}`,
            path: path.join(
              exportPath,
              'attachments',
              `${attachment._id}-${attachment.name}.${attachment.extension}`
            )
          }
        })),
        exportPath
      };
    },

    async insertDocs(req, docs, reporting) {
      const duplicatedDocs = [];
      const duplicatedIds = [];
      const failedIds = [];

      for (const doc of docs) {
        const cloned = cloneDeep(doc);

        try {
          const inserted = await self.insertOrUpdateDoc(req, {
            doc,
            duplicatedIds,
            failedIds
          });
          if (inserted) {
            reporting.success();
          }
        } catch (error) {
          if (!self.apos.doc.isUniqueError(error)) {
            reporting.failure();
            failedIds.push(cloned.aposDocId);
            self.apos.util.error(error);
            continue;
          }

          const isSingleton = self.apos.modules[cloned.type] &&
              self.apos.modules[cloned.type].options.singleton === true;

          if (isSingleton) {
            try {
              await self.insertOrUpdateDoc(req, {
                doc: cloned,
                method: 'update',
                duplicatedIds,
                failedIds
              });
              reporting.success();
            } catch (err) {
              reporting.failure();
              failedIds.push(cloned.aposDocId);
            }
          } else if (cloned.aposMode === 'draft') {
            duplicatedDocs.push({
              aposDocId: cloned.aposDocId,
              title: cloned.title,
              type: cloned.type,
              updatedAt: cloned.updatedAt
            });
            duplicatedIds.push(cloned.aposDocId);
          }
        }
      }

      return {
        duplicatedDocs,
        duplicatedIds,
        failedIds
      };
    },

    async insertAttachments(req, {
      attachmentsInfo, reporting, duplicatedIds, docIds
    }) {
      const importedAttachments = [];

      for (const attachmentInfo of attachmentsInfo) {
        try {
          await self.insertOrUpdateAttachment(req, {
            attachmentInfo,
            duplicatedIds,
            docIds
          });
          importedAttachments.push(attachmentInfo.attachment._id);
          reporting.success();
        } catch (err) {
          self.apos.util.error(err);
        }
      }

      return importedAttachments;
    },

    // TODO: Should we stop the published version from being imported if the draft failed?
    async insertOrUpdateDoc(req, {
      doc, method = 'insert', duplicatedIds, failedIds
    }) {
      const isPage = self.apos.page.isPage(doc);
      const manager = isPage
        ? self.apos.page
        : self.apos.modules[doc.type];

      if (!manager) {
        throw new Error(`No manager found for this module: ${doc.type}`);
      }

      // Import can be disable at the page-type level
      if (!self.canImport(req, doc.type)) {
        throw new Error(`Import is disabled for this module: ${doc.type}`);
      }

      if (doc.aposMode === 'published') {
        if (failedIds && failedIds.includes(doc.aposDocId)) {
          throw new Error('Inserting document failed');
        }

        if (duplicatedIds && duplicatedIds.includes(doc.aposDocId)) {
          return false;
        }

        if (manager.options.autopublish === true) {
          return true;
        }
      }

      if (isPage) {
        return method === 'update'
          ? manager[method](req, doc, { setModified: false })
          : manager[method](req, '_home', 'lastChild', doc, { setModified: false }); // TODO: manage target?
      }

      return manager[method](req, doc, { setModified: false });
    },

    async insertOrUpdateAttachment(req, {
      attachmentInfo: { attachment, file }, duplicatedIds, docIds
    }) {
      // TODO: Find a more efficient way to compare only relatedIds
      // (we need to find a way to keep autopublish published IDs in that case)
      if (duplicatedIds && docIds) {
        const relatedIds = attachment.docIds
          .reduce((acc, id) => {
            const aposId = id.replace(/:.+$/, '');
            return [
              ...acc,
              ...acc.includes(aposId) || !docIds.has(aposId) ? [] : [ aposId ]
            ];
          }, []);

        if (duplicatedIds && relatedIds.every((id) => duplicatedIds.includes(id))) {
          throw self.apos.error(`Related documents have not been imported for attachment: ${attachment._id}`);
        }
      }

      try {
        await self.apos.attachment.insert(
          req,
          file,
          { attachmentId: attachment._id }
        );
      } catch (err) {
        if (err.message === 'duplicate') {
          await self.apos.attachment.update(
            req,
            file,
            attachment
          );
        } else {
          throw err;
        }
      }
    },

    async cleanFile(exportPath) {
      try {
        const stat = await fsp.lstat(exportPath);
        if (stat.isDirectory()) {
          await fsp.rm(exportPath, {
            recursive: true,
            force: true
          });
        } else {
          await fsp.unlink(exportPath);
        }
      } catch (err) {
        self.apos.util.error(
          `Error while trying to remove the file or folder: ${exportPath}. You might want to remove it yourself.`
        );
      }
    },

    async overrideDuplicates(req) {
      const exportPath = self.apos.launder.string(req.body.exportPath);
      const docIds = self.apos.launder.strings(req.body.docIds);
      const jobId = self.apos.launder.string(req.body.jobId);
      const importedAttachments = self.apos.launder.strings(req.body.importedAttachments);
      const failedIds = [];

      const jobManager = self.apos.modules['@apostrophecms/job'];
      const job = await jobManager.db.findOne({ _id: jobId });

      const { docs, attachmentsInfo } = await self.getFilesData(exportPath, docIds);

      for (const doc of docs) {
        try {
          const attachmentsToOverride = self.getRelatedDocsFromSchema(req, {
            doc,
            schema: self.apos.modules[doc.type].schema,
            type: 'attachment'
          });

          await self.insertOrUpdateDoc(req, {
            doc,
            method: 'update',
            failedIds
          });

          jobManager.success(job);

          for (const { _id } of attachmentsToOverride) {
            if (importedAttachments.includes(_id)) {
              continue;
            }
            const attachmentInfo = attachmentsInfo
              .find(({ attachment }) => attachment._id === _id);

            try {
              await self.insertOrUpdateAttachment(req, { attachmentInfo });
              jobManager.success(job);
              importedAttachments.push(_id);
            } catch (err) {
              jobManager.failure(job);
            }
          }
        } catch (err) {
          jobManager.failure(job);
          failedIds.push(doc.aposDocId);
          self.apos.util.error(err);
          continue;
        }
      }

      if (failedIds.length) {
        await self.apos.notify(req, 'aposImportExport:importFailedForSome', {
          interpolate: {
            count: failedIds.length
          },
          dismiss: true,
          icon: 'database-import-icon',
          type: 'danger'
        });
      }
    },

    async cleanExport(req) {
      const exportPath = self.apos.launder.string(req.body.exportPath);
      const jobId = self.apos.launder.string(req.body.jobId);
      const notificationId = self.apos.launder.string(req.body.notificationId);

      const jobManager = self.apos.modules['@apostrophecms/job'];
      const job = await jobManager.db.findOne({ _id: jobId });

      jobManager.end(job, true);

      self.apos.notification.dismiss(req, notificationId, 2000)
        .catch((error) => {
          self.apos.util.error(error);
        });
      await self.cleanFile(exportPath);
    }
  };
};
