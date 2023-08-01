<template>
  <div v-if="showData">
    <div class="row row-equal justify-space-between">
      <div class="flex">
        <div class="row align-center">
          <div class="flex">
            <h1 class="va-h1">{{ organism.scientific_name }}</h1>
            <p v-if="organism.insdc_common_name">{{ organism.insdc_common_name }}</p>
          </div>
        </div>
      </div>
      <div class="flex">
        <div class="row row-equal align-center">
          <div class="flex">
            <a target="_blank" :href="`https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${organism.taxid}`">
              <va-avatar size="large">
                <img :src="'/ncbi.png'" />
              </va-avatar>
            </a>
          </div>
          <div class="flex">
            <a target="_blank" :href="`https://www.ebi.ac.uk/ena/browser/view/${organism.taxid}`">
              <va-avatar size="large">
                <img :src="'/ena.jpeg'" />
              </va-avatar>
            </a>
          </div>
        </div>
      </div>
    </div>
    <div class="row row-equal">
      <div class="flex lg12 md12 sm12 xs12">
        <va-chip :to="{ name: 'taxon', params: { taxid: taxon.taxid } }" v-for="(taxon, index) in taxons" :key="index" flat>{{
          taxon.name }}</va-chip>
      </div>
    </div>
    <div class="row row-equal">
      <div v-if="organism.assemblies.length" class="flex">
        <va-card class="mb-4" color="secondary">
          <va-card-content>
            <h2 class="va-h4 ma-0" style="color: white">{{ organism.assemblies.length }}</h2>
            <p style="color: white">{{ t('modelStats.assemblies') }}</p>
          </va-card-content>
        </va-card>
      </div>
      <div v-if="organism.annotations.length" class="flex">
        <va-card class="mb-4" color="secondary">
          <va-card-content>
            <h2 class="va-h4 ma-0" style="color: white">{{ organism.annotations.length }}</h2>
            <p style="color: white">{{ t('modelStats.annotations') }}</p>
          </va-card-content>
        </va-card>
      </div>
    </div>
    <div class="row row-equal">
      <div v-if="organism.image_urls.length" class="flex lg6 md6 sm12 xs12">
        <va-card>
          <va-card-title> {{ t('organismDetails.images') }} </va-card-title>
          <va-carousel stateful :items="organism.image_urls"> </va-carousel>
        </va-card>
      </div>
      <div v-if="Object.keys(organism.metadata).length" class="flex lg6 md6 sm12 xs12">
        <va-card>
          <va-card-title> {{ t('uiComponents.metadata') }} </va-card-title>
          <va-card-content>
            <Metadata :metadata="organism.metadata" />
          </va-card-content>
        </va-card>
      </div>
    </div>
  </div>
  <div v-else>
    <h3 class="va-h3">
      {{ error }}
    </h3>
  </div>
</template>
<script setup lang="ts">
import OrganismService from '../../services/clients/OrganismService'
import { onMounted, ref } from 'vue'
import Metadata from '../../components/ui/Metadata.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const showData = ref(false)
const error = ref('')
const props = defineProps({
  taxid: String,
})
const taxons = ref([])
const organism = ref({})

onMounted(async () => {
  try {
    const { data } = await OrganismService.getOrganism(props.taxid)
    organism.value = { ...data }
    taxons.value = (await OrganismService.getOrganismLineage(props.taxid)).data
    showData.value = true
  } catch (e) {
    console.log(e)
    if (e.response) {
      error.value = props.taxid + ' ' + e.response.data.message
    }
    showData.value = false
  }
})

</script>

<style scoped lang="scss">
.chart {
  height: 400px;
}

.row-equal .flex {
  .va-card {
    height: 100%;
  }
}

.va-card {
  margin-bottom: 0 !important;

  &__title {
    display: flex;
    justify-content: space-between;
  }
}

.list__item+.list__item {
  margin-top: 10px;
}
</style>
