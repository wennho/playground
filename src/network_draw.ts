import * as nn from "./nn";
import {reset, updateUI, updateDecisionBoundary, heatMap, boundary} from "./playground"
import {HeatMap} from "./heatmap";
import {ElementType, ElementUI, NetworkUI, RECT_SIZE} from "./network_ui";
import {INPUTS, DENSITY, xDomain} from "./common";
import {Mode, state, n} from "./state";

const BIAS_SIZE = 5;

function d3update(n: nn.Network) {

  // Get the width of the svg container.
  let co = d3.select(".column.output").node() as HTMLDivElement;
  let cf = d3.select(".column.features").node() as HTMLDivElement;
  let width = co.offsetLeft - cf.offsetLeft;

  let netUI = new NetworkUI(n, width);
  d3updateLinks(netUI);
  d3updateNodes(netUI);
}

interface LinkData {
  link : nn.Link,
  sourceEle : ElementUI,
  destEle : ElementUI,
  linkEle : ElementUI,
}

function d3updateLinks(netUI:NetworkUI){

  let numLayers = n.network.length;
  let linkList : LinkData[] = [];

  // Draw links.
  for (let layerIdx = 1; layerIdx < numLayers ; layerIdx++) {
    let numNodes = n.network[layerIdx].length;
    for (let i = 0; i < numNodes; i++) {
      let node = n.network[layerIdx][i];
      for (let j = 0; j < node.inputLinks.length; j++) {
        let l = node.inputLinks[j];
        linkList.push({
          link : l,
          sourceEle : netUI.id2elem[l.source.id],
          destEle : netUI.id2elem[l.dest.id],
          linkEle : netUI.id2elem[l.id],
        });
      }
    }
  }

  // JOIN new data with old elements.
  let links = d3.select("g.core")
    .selectAll("g.link")
    .data(linkList, function (d) {
      return d.link.id;
    });

  // UPDATE
  // shift existing nodes to their new positions
  links.each(transitionLink);

  // ENTER
  // Create new elements as needed.
  links.enter()
    .insert("g")
    .classed("link", true)
    .style("opacity", 0)
    .each(drawLink)
    .transition()
    .duration(500)
    .style("opacity", 1);

  // EXIT
  // Remove old elements as needed.
  links.exit()
    .transition()
    .style("opacity", 1e-6)
    .remove();
}

function d3updateNodes(netUI:NetworkUI){

  // JOIN new data with old elements.
  let canvasNodes =
    d3.select("#network")
    .selectAll("div.canvas")
    .data(netUI.nodes, function (d) { return d.id;});
  let svgNodes =
    d3.select("g.core")
      .selectAll("g.node")
      .data(netUI.nodes, function (d) { return d.id;});

  // UPDATE
  // shift existing nodes to their new positions
  canvasNodes.transition()
    .style('left',function (d) {
      let x = d.cx - RECT_SIZE / 2;
      return `${x + 3}px`;
    })
    .style('top',function (d) {
      let y = d.cy - RECT_SIZE / 2;
      return `${y + 3}px`;
    });
  svgNodes.transition()
    .attr("transform", function(d){
      let x = d.cx - RECT_SIZE / 2;
      let y = d.cy - RECT_SIZE / 2;
      return `translate(${x},${y})`;
    });

  // ENTER
  // Create new elements as needed.
  canvasNodes.enter().insert("div", ":first-child")
    .style("opacity", 1e-6)
    .each(drawNodeCanvas)
    .transition()
    .duration(500)
    .style("opacity", 1);

  svgNodes.enter().insert("g")
    .style("opacity", 1e-6)
    .each(drawNode)
    .transition()
    .duration(500)
    .style("opacity", 1);

  // EXIT
  // Remove old elements as needed.
  canvasNodes.exit()
    .each(function (){
      d3.select(this)
        .select("canvas.node-heat-map")
        // remove the class so that it's not called by heatmap.updateBackground
        .classed("node-heat-map", false);
    })
    .transition()
    .style("opacity", 1e-6)
    .remove();

  svgNodes.exit()
    .transition()
    .style("opacity", 1e-6)
    .remove();
}



// Draw network
export function drawNetwork(n: nn.Network): void {
  let network: nn.Node[][] = n.network;
  let svg = d3.select("#svg");
  // Remove all svg elements.
  d3.select("#network").selectAll("div.plus-minus-neurons").remove();

  // Get the width of the svg container.
  let padding = 3;
  let co = d3.select(".column.output").node() as HTMLDivElement;
  let cf = d3.select(".column.features").node() as HTMLDivElement;
  let width = co.offsetLeft - cf.offsetLeft;
  svg.attr("width", width);


  if (svg.select("g.core").empty()){
    svg.append("g")
      .classed("core", true)
      .attr("transform", `translate(${padding},${padding})`)
  }

  // Draw the network layer by layer.
  let numLayers = n.network.length;
  let featureWidth = 118;
  let layerScale = d3.scale.ordinal<number, number>()
    .domain(d3.range(1, numLayers - 1))
    .rangePoints([featureWidth, width - RECT_SIZE], 0.7);


  let calloutThumb = d3.select(".callout.thumbnail").style("display", "none");
  let calloutWeights = d3.select(".callout.weights").style("display", "none");
  let netUI = new NetworkUI(n,width);

  // add control for layers
  d3.selectAll(".plus-minus-layers").remove();
  addLayerControl(1,layerScale(1) - 40);
  for (let layerIdx = 2; layerIdx < numLayers - 1; layerIdx++){
    let x = (layerScale(layerIdx) + layerScale(layerIdx-1))/2;
    addLayerControl(layerIdx,x);
  }
  addLayerControl(numLayers-1,layerScale(numLayers-2) + 40);

  // Draw the intermediate layer controls. Draw this after links so that it is on top
  for (let layerIdx = 1; layerIdx < numLayers - 1; layerIdx++) {
    addPlusMinusControl(layerScale(layerIdx), layerIdx, n);
  }

  // Output node is drawn separately
  let node = network[numLayers - 1][0];
  // add click listener
  d3.select('#heatmap').on('click', function(){
    if (state.mode == Mode.AddEdge) {
      selectNode(d3.select('#heatmap'), node);
    }
  });

  // Adjust the height of the svg.
  svg.attr("height", netUI.maxY);

  // Adjust the height of the features column.
  let height = Math.max(
    getRelativeHeight(calloutThumb),
    getRelativeHeight(calloutWeights),
    getRelativeHeight(d3.select("#network"))
  );
  d3.select(".column.features").style("height", height + "px");

  d3update(n);
}

function getRelativeHeight(selection: d3.Selection<any>) {
  let node = selection.node() as HTMLAnchorElement;
  return node.offsetHeight + node.offsetTop;
}

function addLayerControl(layer:number, x:number) {

  let div = d3.select("#network");
  div.append("button")
    .attr("class", "mdl-button mdl-js-button mdl-button--icon plus-minus-layers")
    .style({
      left: x+8 + 'px',
    })
    .on("click", () => {
      n.addLayer(layer);
      reset();
    })
    .append("i")
    .attr("class", "material-icons")
    .text("add");

}

function addPlusMinusControl(x: number, layerIdx: number, n:nn.Network) {
  let div = d3.select("#network").append("div")
    .classed("plus-minus-neurons", true)
    .style("left", `${x - 10}px`);

  let numNeurons = n.network[layerIdx].length;
  div.append("button")
    .attr("class", "mdl-button mdl-js-button mdl-button--icon")
    .style({
      position:"absolute",
      top:"-40px",
      left:0,
      right:0,
      "margin-right":"auto",
      "margin-left":"auto",
    })
    .on("click", () => {
      n.removeLayer(layerIdx);
      reset();
    })
    .append("i")
    .attr("class", "material-icons")
    .text("remove");

  let firstRow = div.append("div").attr("class", `ui-numNodes${layerIdx}`);
  firstRow.append("button")
    .attr("class", "mdl-button mdl-js-button mdl-button--icon")
    .on("click", () => {
      if (numNeurons >= 8) {
        return;
      }
      n.addNode(layerIdx);
      reset(false);
    })
    .append("i")
    .attr("class", "material-icons")
    .text("add");

  firstRow.append("button")
    .attr("class", "mdl-button mdl-js-button mdl-button--icon")
    .on("click", () => {
      let numNeurons = n.network[layerIdx].length;
      if (numNeurons <= 1) {
        return;
      }
      n.removeNode(n.network[layerIdx][0]); // remove the first node
      reset();
    })
    .append("i")
    .attr("class", "material-icons")
    .text("remove");

  let suffix = numNeurons > 1 ? "s" : "";
  div.append("div").text(
    numNeurons + " neuron" + suffix
  );
}

function updateHoverCard(type: ElementType, nodeOrLink?: nn.Node | nn.Link,
                         coordinates?: [number, number]) {
  let hovercard = d3.select("#hovercard");
  if (type == null) {
    hovercard.style("display", "none");
    d3.select("#svg").on("click", null);
    return;
  }

  // actions when the node or link is clicked
  d3.select("#svg").on("click", () => {

    if (state.mode === Mode.DeleteEdge && nodeOrLink instanceof nn.Link) {
      n.removeLink(nodeOrLink);
      let hovercard = d3.select("#hovercard");
      hovercard.style("display", "none");
      d3.select("#svg").on("click", null);
      reset();
      return;
    }

    hovercard.select(".value").style("display", "none");
    let input = hovercard.select("input");
    input.style("display", null);
    input.on("input", function() {
      if (this.value != null && this.value !== "") {
        if (type === ElementType.LINK) {
          (nodeOrLink as nn.Link).weight = +this.value;
        } else {
          (nodeOrLink as nn.Node).bias = +this.value;
        }
        updateUI();
      }
    });
    input.on("keypress", () => {
      if ((d3.event as any).keyCode === 13) {
        updateHoverCard(type, nodeOrLink, coordinates);
      }
    });
    (input.node() as HTMLInputElement).focus();
  });
  let value = (type === ElementType.LINK) ?
    (nodeOrLink as nn.Link).weight :
    (nodeOrLink as nn.Node).bias;
  let error = (type === ElementType.LINK) ?
    (nodeOrLink as nn.Link).error :
    (nodeOrLink as nn.Node).error;
  let name = (type === ElementType.LINK) ? "Weight" : "Bias";
  hovercard.style({
    "left": `${coordinates[0] + 20}px`,
    "top": `${coordinates[1]}px`,
    "display": "block"
  });
  hovercard.select(".type").text(name);
  hovercard.select(".value")
    .style("display", null)
    .text(value.toPrecision(2));
  hovercard.select(".error-value")
    .style("display", null)
    .text((error*100).toPrecision(3));
  hovercard.select("input")
    .property("value", value.toPrecision(2))
    .style("display", "none");
}

function calculateOffset(index, length) {
  return ((index - (length - 1) / 2) / length) * 12;
}

function generateLinkPath(d:LinkData) : string {
  let link = d.link;
  let source = d.sourceEle;
  let dest = d.destEle;
  let offset = RECT_SIZE * 1.2;
  let dPath : string = null;
  let destInputLinks = dest.links;
  let indexBeforeDest = destInputLinks.indexOf(link.id);
  let destOffset = calculateOffset(indexBeforeDest, destInputLinks.length);

  if (!link.isLong) {
    let datum = {
      source: {
        y: source.cx + RECT_SIZE / 2 + 2,
        x: source.cy
      },
      target: {
        y: dest.cx - RECT_SIZE / 2,
        x: dest.cy + destOffset
      }
    };
    let diagonal = d3.svg.diagonal().projection(d => [d.y, d.x]);
    dPath = diagonal(datum,0);

  } else {

    // draw the start
    let lineData : [number,number][] = [
      [source.cx + RECT_SIZE / 2 + 2, source.cy],
      [source.cx + RECT_SIZE / 2 + 2 + offset, source.cy]
    ];

    // draw the middle
    for (let i = link.sourceLayer()+1; i < link.destLayer(); i++) {
      let linkEle = d.linkEle[i];

      let intermediateOffset = calculateOffset(linkEle.links.indexOf(link.id),linkEle.links.length);

      let cy = linkEle.cy;
      let cx = linkEle.cx;
      lineData.push([cx - offset, cy + intermediateOffset]);
      lineData.push([cx + offset, cy + intermediateOffset]);
    }

    // draw the end
    lineData.push([
      dest.cx - RECT_SIZE / 2 - offset,
      dest.cy + destOffset
    ]);

    lineData.push([
      dest.cx - RECT_SIZE / 2,
      dest.cy + destOffset
    ]);

    let lineFunction = d3.svg.line()
      .x(function(d) { return d[0]; })
      .y(function(d) { return d[1]; })
      .interpolate("basis");

    dPath = lineFunction(lineData);
  }

  return dPath;
}


function transitionLink(d:LinkData) {
  let container = d3.select(this);
  let dPath : string = generateLinkPath(d);

  // back-most line to show error rate
  container.select("path.errorlink")
    .transition()
    .attr("d", dPath);

  // line to show weights
  container.select("path.link")
    .transition()
    .attr("d", dPath);

  // The invisible thick link that will be used for showing the weight value on hover.
  container.select("path.link-hover")
    .attr("d", dPath);
}


function drawLink(d:LinkData) {

  let container = d3.select(this);
  let line = container.insert("path", ":first-child");
  let dPath : string = generateLinkPath(d);

  let link = d.link;

  // back-most line to show error rate
  line.attr({
    "d" : dPath,
    "class": "errorlink",
    id: "errorline" + link.source.id + "-" + link.dest.id,
  });

  // line to show weights
  container.append("path").attr({
    "marker-start": "url(#markerArrow)",
    "class": "link",
    id: "link" + link.source.id + "-" + link.dest.id,
    d: dPath
  });

  // Add an invisible thick link that will be used for showing the weight value on hover.
  // This has to be last so that it's on top.
  container.append("path")
    .attr({
      "d": dPath,
      "class": "link-hover",
    })
    .on("mouseenter", function() {
      updateHoverCard(ElementType.LINK, link, d3.mouse(this));
    }).on("mouseleave", function() {
      updateHoverCard(null);
    });
}

let selectedNode : nn.Node = null;
let selectedDiv = null;
export let selectedNodeId: string = null;

function selectNode(div, node : nn.Node) {
  if (selectedNode == null) {
    selectedNode = node;
    selectedDiv = div;
    div.classed("selected", true);
    d3.select('#info').text('Node ' + node.id + ' selected. Click on another node to create a link.');
  } else if (selectedNode.id == node.id) {
    selectedNode = null;
    selectedDiv = null;
    div.classed("selected", false);
    d3.select('#info').text('Node ' + node.id + ' unselected.');
  } else {
    // first check that link does not already exist
    let selectedNodeLayer = n.node2layer[selectedNode.id];
    let nodeLayer = n.node2layer[node.id];
    let fromNode;
    let toNode;

    if (selectedNodeLayer == nodeLayer || selectedNode.isLinked(node)) {

      // check for a case where one of the nodes has no inputs. Then we can create a link.
      if (selectedNode.inputLinks.length == 0 && node.inputLinks.length > 0) {
        fromNode = node;
        toNode = selectedNode;
      } else if (node.inputLinks.length == 0 && selectedNode.inputLinks.length > 0) {
        fromNode = selectedNode;
        toNode = node;
      } else {
        // too bad, it is invalid
        d3.select('#info').text('Cannot create link. Invalid target.');
        return;
      }
    } else {
      fromNode = selectedNodeLayer < nodeLayer ? selectedNode : node;
      toNode = selectedNodeLayer > nodeLayer ? selectedNode : node;
    }

    n.addLink(fromNode, toNode);
    d3.select('#info').text('Link between nodes ' + node.id + ' and ' + selectedNode.id + ' created.');
    selectedNode = null;
    selectedDiv.classed("selected", false);
    selectedDiv = null;
    reset();
  }
}

// Draws the heatmap portion of the node
function drawNodeCanvas(d : ElementUI){

  if (d.type != ElementType.NODE) {
    throw new Error("Not a node element");
  }

  if (d.id == n.getOutputNode().id) {
    return; // no need to draw heatmap for output node
  }

  let div = d3.select(this);
  let x = d.cx - RECT_SIZE / 2;
  let y = d.cy - RECT_SIZE / 2;

  // Draw the node's canvas.
  div.attr({
      "id": `canvas-${d.id}`,
      "class": "canvas"
    })
    .style({
      position: "absolute",
      left: `${x + 3}px`,
      top: `${y + 3}px`
    })
    .on("mouseenter", function() {
      selectedNodeId = d.id;
      div.classed("hovered", true);
      updateDecisionBoundary(n.network, false);
      heatMap.updateBackground(boundary[d.id], state.discretize);
    })
    .on("mouseleave", function() {
      selectedNodeId = null;
      div.classed("hovered", false);
      updateDecisionBoundary(n.network, false);
      heatMap.updateBackground(boundary[n.getOutputNode().id],
        state.discretize);
    })
    .on("click", function(){
      if (state.mode == Mode.AddEdge) {
        selectNode(div, n.id2node[d.id]);
      }
    });

  if (d.isInput) {
    div.on("click", function() {

      if (state.mode == Mode.AddEdge) {
        selectNode(div, n.findNode(d.id));
        return;
      }

      // add or remove input node
      state[d.id] = !state[d.id];
      if (state[d.id]) {
        n.addInput(d.id);
      } else {
        n.removeNode(n.findNode(d.id));
      }

      reset();
    });
    div.style("cursor", "pointer");

    let activeOrNotClass = state[d.id] ? "active" : "inactive";
    div.classed(activeOrNotClass, true);
  }

  let nodeHeatMap = new HeatMap(RECT_SIZE, DENSITY / 10, xDomain,
    xDomain, div, {noSvg: true});

  nodeHeatMap.canvas.datum({heatmap: nodeHeatMap, id: d.id});

}



function drawNode(d:ElementUI) {

  let x = d.cx - RECT_SIZE / 2;
  let y = d.cy - RECT_SIZE / 2;

  let nodeGroup = d3.select(this);

  nodeGroup.attr({
    "class": "node",
    "id": `node-${d.id}`,
    "transform": `translate(${x},${y})`,
  });

  // Draw the main rectangle.
  nodeGroup.append("rect")
    .attr({
      x: 0,
      y: 0,
      width: RECT_SIZE,
      height: RECT_SIZE,
    });
  let activeOrNotClass = state[d.id] ? "active" : "inactive";

  if (d.isInput) {
    let label = INPUTS[d.id].label != null ?
      INPUTS[d.id].label : d.id;
    // Draw the input label.
    let text = nodeGroup.append("text").attr({
      "class": "main-label",
      x: -10,
      y: RECT_SIZE / 2,
      "text-anchor": "end"
    });
    if (/[_^]/.test(label)) {
      let myRe = /(.*?)([_^])(.)/g;
      let myArray;
      let lastIndex;
      while ((myArray = myRe.exec(label)) != null) {
        lastIndex = myRe.lastIndex;
        let prefix = myArray[1];
        let sep = myArray[2];
        let suffix = myArray[3];
        if (prefix) {
          text.append("tspan").text(prefix);
        }
        text.append("tspan")
          .attr("baseline-shift", sep === "_" ? "sub" : "super")
          .style("font-size", "9px")
          .text(suffix);
      }
      if (label.substring(lastIndex)) {
        text.append("tspan").text(label.substring(lastIndex));
      }
    } else {
      text.append("tspan").text(label);
    }
    nodeGroup.classed(activeOrNotClass, true);
  }

  if (!d.isInput) {
    // draw the option labels
    let text = nodeGroup.append("text").attr({
      "class": "option-label",
      x: 0,
      y: RECT_SIZE + 13,
      "text-anchor": "start"
    });
    text.append("tspan").text('Remove');
    text.on("click", function() {
      n.removeNode(n.id2node[d.id]);
      reset();
    });
    text.style("cursor", "pointer");


    let errorText = nodeGroup.append("text").attr({
      "class": "option-label",
      id: `error-${d.id}`,
      x: RECT_SIZE + 7,
      y: RECT_SIZE - 4,
      "text-anchor": "start"
    });
    errorText.text('Error:');

    // Draw the node's bias.
    nodeGroup.append("rect")
      .attr({
        id: `bias-${d.id}`,
        x: -BIAS_SIZE - 2,
        y: RECT_SIZE - BIAS_SIZE + 3,
        width: BIAS_SIZE,
        height: BIAS_SIZE,
      }).on("mouseenter", function() {
      updateHoverCard(ElementType.NODE, n.id2node[d.id], d3.mouse(nodeGroup.node().parentNode));
    }).on("mouseleave", function() {
      updateHoverCard(null);
    });
  }

}