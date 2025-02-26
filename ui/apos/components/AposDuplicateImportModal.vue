<template>
  <AposModal
    :modal="modal"
    class="apos-import-duplicate"
    @esc="cancel"
    @no-modal="closeModal"
    @inactive="modal.active = false"
    @show-modal="modal.showModal = true"
    @ready="ready"
  >
    <template #main>
      <AposModalBody>
        <template #bodyMain>
          <h2 class="apos-import-duplicate__heading">
            {{ $t('aposImportExport:import', { type: moduleLabel }) }}
          </h2>
          <p class="apos-import-duplicate__description">
            <strong>{{ $t('aposImportExport:importDuplicateDetected') }}</strong><br>
            {{ $t('aposImportExport:importDuplicateMessage') }}
          </p>

          <div class="apos-import-duplicate__section">
            <table class="apos-table">
              <tbody>
                <tr>
                  <th class="apos-table__header">
                    <AposButton
                      class="apos-toggle"
                      :class="{ 'apos-toggle--blank': !checked.length }"
                      data-apos-test="contextMenuTrigger"
                      type="quiet"
                      :text-color="checkboxIconColor"
                      :icon="checkboxIcon"
                      :icon-only="true"
                      :icon-size="10"
                      @click.stop="toggle"
                    />
                  </th>
                  <th class="apos-table__header">
                    {{ $t('aposImportExport:title') }}
                  </th>
                  <th class="apos-table__header">
                    {{ $t('aposImportExport:type') }}
                  </th>
                  <th class="apos-table__header">
                    {{ $t('aposImportExport:lastEdited') }}
                  </th>
                </tr>
                <tr
                  v-for="doc in duplicatedDocs"
                  :key="doc.aposDocId"
                  class="apos-table__row"
                >
                  <td class="apos-table__cell">
                    <AposCheckbox
                      v-model="checked"
                      tabindex="-1"
                      :choice="{
                        value: doc.aposDocId,
                        label: doc.title
                      }"
                      :field="{
                        label: doc.title,
                        name: doc.aposDocId,
                        hideLabel: true
                      }"
                    />
                  </td>
                  <td class="apos-table__cell">
                    {{ doc.title }}
                  </td>
                  <td class="apos-table__cell">
                    {{ docLabel(doc) }}
                  </td>
                  <td class="apos-table__cell">
                    {{ lastEdited(doc) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="apos-import-duplicate__separator" />

          <div class="apos-import-duplicate__btns">
            <AposButton
              class="apos-import-duplicate__btn"
              label="apostrophe:cancel"
              @click="cancel"
            />
            <AposButton
              ref="runOverride"
              class="apos-import-duplicate__btn"
              :label="$t('aposImportExport:importDuplicateContinue')"
              type="primary"
              @click="runOverride"
            />
          </div>
        </template>
      </AposModalBody>
    </template>
  </AposModal>
</template>

<script>
import dayjs from 'dayjs';

export default {
  props: {
    type: {
      type: String,
      required: true
    },
    duplicatedDocs: {
      type: Array,
      required: true
    },
    exportPath: {
      type: String,
      required: true
    },
    importedAttachments: {
      type: Array,
      required: true
    },
    jobId: {
      type: String,
      required: true
    },
    notificationId: {
      type: String,
      required: true
    }
  },

  emits: [ 'safe-close', 'change' ],

  data() {
    return {
      modal: {
        active: false,
        type: 'overlay',
        showModal: false,
        disableHeader: true
      },
      checked: [],
      importRunning: false
    };
  },
  computed: {
    moduleLabel() {
      const moduleOptions = apos.modules[this.type];
      const label = moduleOptions.pluralLabel;

      return this.$t(label).toLowerCase();
    },
    checkboxIcon() {
      if (!this.checked.length) {
        // we could return `null` but having no svg when no element are selected
        // makes a shifting glitch
        return 'checkbox-blank-icon';
      }
      if (this.checked.length === this.duplicatedDocs.length) {
        return 'check-bold-icon';
      }
      return 'minus-icon';
    },
    checkboxIconColor() {
      return this.checked.length
        ? 'var(--a-white)'
        : 'transparent';
    }
  },

  async mounted() {
    this.modal.active = true;
    this.checked = this.duplicatedDocs.map(({ aposDocId }) => aposDocId);
  },

  methods: {
    async closeModal() {
      if (!this.importRunning) {
        await this.cleanExportFile();
      }
      this.$emit('safe-close');
    },
    async cleanExportFile() {
      try {
        await apos.http.post('/api/v1/@apostrophecms/import-export/clean-export', {
          body: {
            exportPath: this.exportPath,
            jobId: this.jobId,
            notificationId: this.notificationId
          }
        });
      } catch (error) {
        apos.notify(this.$t('aposImportExport:importCleanFailed'), {
          type: 'warning',
          interpolate: {
            exportPath: this.exportPath
          }
        });
      } finally {
        apos.bus.$emit('import-ended');
      }
    },
    ready() {
      this.$refs.runOverride.$el.querySelector('button').focus();
    },
    async runOverride() {
      this.importRunning = true;
      apos.http.post('/api/v1/@apostrophecms/import-export/override-duplicates', {
        body: {
          docIds: this.checked,
          importedAttachments: this.importedAttachments,
          exportPath: this.exportPath,
          jobId: this.jobId
        }
      }).catch(() => {
        apos.notify(this.$t('aposImportExport:exportFailed'), {
          type: 'danger',
          dismiss: true
        });
      }).finally(() => {
        this.cleanExportFile();
      });

      this.modal.showModal = false;
    },
    async cancel() {
      this.modal.showModal = false;
    },
    toggle() {
      this.checked = this.checked.length
        ? []
        : this.duplicatedDocs.map(({ aposDocId }) => aposDocId);
    },
    docLabel(doc) {
      const moduleOptions = apos.modules[this.type];

      return moduleOptions?.label
        ? this.$t(moduleOptions?.label)
        : doc.type;
    },
    lastEdited(doc) {
      return dayjs(doc.updatedAt).format(this.$t('aposImportExport:dayjsTitleDateFormat'));
    }
  }
};
</script>

<style lang="scss" scoped>
.apos-import-duplicate {
  z-index: $z-index-modal;
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

::v-deep .apos-modal__inner {
  top: auto;
  right: auto;
  bottom: auto;
  left: auto;
  height: auto;
  text-align: left;
}

::v-deep .apos-modal__overlay {
  .apos-modal+.apos-export & {
    display: block;
  }
}

::v-deep .apos-modal__body {
  padding: 30px 20px;
}

::v-deep .apos-modal__body-main {
  display: flex;
  flex-direction: column;
  align-items: baseline;
}

::v-deep .apos-toggle__slider {
  display: flex;
}

::v-deep .apos-input--select {
  text-transform: capitalize;
}

.apos-import-duplicate__heading {
  @include type-title;
  line-height: var(--a-line-tall);
  margin: 0;
  text-transform: capitalize;
}

.apos-import-duplicate__description {
  @include type-base;
  font-size: var(--a-type-large);
  text-align: left;
  line-height: var(--a-line-tallest);
  margin-top: 15px;
  margin-bottom: 20px;
  padding: 10px;
  background-color: var(--a-warning-fade);
  color: var(--a-warning-dark);
  width: calc(100% - 20px);
}

.apos-import-duplicate__section {
  @include type-base;
  display: flex;
  flex-direction: column;
  align-items: baseline;
}

.apos-import-duplicate__section .apos-table__header {
  font-weight: inherit;
  padding: 5px 15px;
}

.apos-import-duplicate__section .apos-table__cell {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
}

// Override button to style it exactly like other checkboxes
::v-deep .apos-toggle {
  .apos-button {
    padding: 0;
    transition: all 0.1s ease-in-out;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    align-self: flex-start;
    justify-content: center;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid var(--a-primary);
    background-color: var(--a-primary);
  }
  .apos-button:hover:not([disabled]),
  .apos-button:focus:not([disabled]) {
    transform: none;
  }
  .apos-button:focus {
    box-shadow: 0 0 10px var(--a-primary);
  }
}

::v-deep .apos-toggle--blank {
  .apos-button {
    border-color: var(--a-base-4);
    background-color: var(--a-base-10);
  }
  .apos-button:hover {
    border-color: var(--a-base-2);
  }
  .apos-button:focus {
    outline: none;
    box-shadow: 0 0 5px var(--a-base-1);
  }
  .apos-button svg {
    // We need to hide the checkbox-blank-icon svg (wish there were a "blank" svg in the material icons)
    // because it is visible inside the input.
    // Just changing the color to transparent is not enough as a glitch briefly appears.
    // Hiding it solves it all.
    visibility: hidden;
  }
}

.apos-import-duplicate__separator {
  background-color: var(--a-base-9);
  position: relative;
  height: 1px;
  width: calc(100% - 10px);
  margin: 10px 0;

  &:before {
    content: "";
    background-color: var(--a-base-9);
    position: absolute;
    height: 100%;
    width: calc(100% + 60px);
    left: -30px;
    right: 0;
  }
}

::v-deep .apos-schema .apos-field {
  margin-bottom: $spacing-base;
}

.apos-import-duplicate__btns {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  width: 100%;
  gap: 20px;
}

.apos-import-duplicate__btn ::v-deep .apos-button__label {
  text-transform: capitalize;
}

@keyframes expand {
  0% {
    height: 0;
  }

  100% {
    height: var(--container-height);
  }
}
</style>
