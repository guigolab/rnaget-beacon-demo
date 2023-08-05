<template>
    <section class="taxonomy">
        <div class="row justify-center align-center">
            <va-card-content class="flex">
                <h2 class="va-h1">Taxonomic exploration</h2>
                <p>Explore the geneidx annotated species taxonomy
                </p>
            </va-card-content>
        </div>
        <Pack/>
            <!-- <div class="row align-center justify-start inputs">
                <va-select class="flex lg4  sm12 xs12" v-model="search.filter_option" label="Search By"
                    :options="options" />
                <va-input class="flex lg4 sm12 xs12" v-model="search.filter" type="search" label="Search species"
                    clearable />
                <va-button class="flex" :disabled="emptyFilter" color="primary" icon="fa-search">Search</va-button>
            </div>
        </div> -->
    </section>
</template>
<script setup lang="ts">
import Pack from '../../components/tree/Pack.vue'




</script>
<style scoped>
section {
    padding-top: 3rem;
    padding-bottom: 3rem;
}
h2, p {
 text-align: center;
}

</style>