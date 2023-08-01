<template>
    <div ref="wrapper">
        <svg ref="pack"></svg>
    </div>
</template>

<script setup lang="ts">
import * as d3 from 'd3'
import { ref,onMounted } from 'vue';
import data from './data.json' 
import { useTreeData } from './setTreeData'

const pack = ref()
const wrapper = ref()
const width = 400
const height = 400

onMounted(()=>{
    createPack()
})

function createPack(){

 const {root, domains} = useTreeData(data)

  const packRoot = d3.pack()
    .size([width, height])
    .padding(3)
  (root
    .sum(d => d.children.length === 0 ? 1 : 0)
    .sort((a, b) => b.value - a.value))

  let focus = root;
  let view;

  const color = d3.scaleOrdinal(d3.quantize(d3.interpolateBrBG, domains.length + 1))

  var div = d3.select(wrapper.value).append('div')
     .style("position", "absolute")
     .style("text-align", "center")
     .style("padding", .5)
     .style("background", "#FFFFFF")
     .style("color", "#313639")
     .style("border", "1px solid #313639")
     .style("border-radius", "8px")
     .style("font-size", "1.3rem")
     .style("opacity", 0);

  const svg = d3.select(pack.value)
      .attr("viewBox", `-${width / 2} -${height / 2} ${width} ${height}`)
      .style("display", "block")
      .style("margin", "0 -14px")
      .style("background", "black")
      .style("cursor", "pointer")
      .on("click", (event) => zoom(event, root));

  const node = svg.append("g")
    .selectAll("circle")
    .data(packRoot.descendants().slice(1))
    .join("circle")
      .attr("fill", d => d.children ? color(d.data.name) : "black")
      .attr("pointer-events", d => !d.children ? "none" : null)
      .on("mouseover", function(event, d) { d3.select(this).attr("stroke", "#ffffff").attr("stroke-width", 3); 
                                    div.transition().duration('50').style("opacity",1);
                                    console.log(d)
                                    let name = d.data.name;
                                    div.html(name).style("left", (event.pageX + 10) + "px")
                                                  .style("top", (event.pageY - 15) + "px");})
      .on("mouseout", function() { d3.select(this).attr("stroke", null); 
                                   div.transition().duration('50').style("opacity", 0); })
      .on("click", (event, d) => focus !== d && (zoom(event, d), event.stopPropagation()));
    
  node.append("title")
      .text(d => !d.data.leaves? `${d.data.name}` : `${d.data.name}\nRelated Organisms: ${d.data.leaves}`);

  const label = svg.append("g")
      .style("font", "10px sans-serif")
      .attr("fill", "white")
      .attr("pointer-events", "none")
      .attr("text-anchor", "middle")
    .selectAll("text")
    .data(packRoot.descendants())
    .join("text")
      .style("fill-opacity", d => d.parent === root ? 1 : 0)
      .style("display", d => d.parent === root ? "inline" : "none")
      .text(d => d.data.name);


  zoomTo([packRoot.x, packRoot.y, packRoot.r * 2]);

  function zoomTo(v) {
    const k = width / v[2];

    view = v;

    label.attr("transform", d => `translate(${(d.x - v[0]) * k},${(d.y - v[1]) * k})`);
    node.attr("transform", d => `translate(${(d.x - v[0]) * k},${(d.y - v[1]) * k})`);
    node.attr("r", d => d.r * k);
  }

  function zoom(event, d) {
    const focus0 = focus;

    focus = d;

    const transition = svg.transition()
        .duration(2000)
        .tween("zoom", d => {
          const i = d3.interpolateZoom(view, [focus.x, focus.y, focus.r * 2]);
          return t => zoomTo(i(t));
        });

    label
      .filter(function(d) { return d.parent === focus || this.style.display === "inline"; })
      .transition(transition)
        .style("fill-opacity", d => d.parent === focus ? 1 : 0)
        .on("start", function(d) { if (d.parent === focus) this.style.display = "inline"; })
        .on("end", function(d) { if (d.parent !== focus) this.style.display = "none"; });
  }

 
}

</script>
<style>

</style>