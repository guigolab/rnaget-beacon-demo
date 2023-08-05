<template>
    <section class="annotations row justify-center align-center">
        <div class="flex lg8 md10 sm12 xs12">
            <va-card-content class="white-text">
                <h2 class="va-h1">Search species</h2>
                <p>The geneidx pipeline is being executed against all chromosome-level genome assemblies released within the
                    Earth Biogenome Project
                </p>
            </va-card-content>
            <div class="row align-center justify-start inputs">
                <va-select class="flex lg4  sm12 xs12" v-model="search.filter_option" label="Search By"
                    :options="options" />
                <va-input class="flex lg4 sm12 xs12" v-model="search.filter" type="search" label="Search species"
                    clearable />
                <va-button class="flex" :disabled="emptyFilter" color="primary" icon="fa-search">Search</va-button>
            </div>
        </div>
    </section>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';

const search = ref<{
    filter: string,
    filter_option: string
}>({
    filter: '',
    filter_option: 'scientific_name'
})

const emptyFilter = computed(() => {
    return search.value.filter.length === 0
})

const options = [
    'scientific_name',
    'tolid',
    'taxid',
    'assembly_name',
    'assembly_accession'
]
</script>
<style scoped>
section {
    background-color: var(--va-secondary);
    min-height: 50vh;
    padding-top: 2rem;
    padding-bottom: 2rem;
}

.inputs {
    gap: 1rem;
    padding: 1rem;
}
</style>