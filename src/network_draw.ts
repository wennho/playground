import * as nn from "./nn";
import {mode, reset, state, updateUI, DENSITY, xDomain, updateDecisionBoundary, heatMap, boundary} from "./playground"
import {HeatMap} from "./heatmap";

const RECT_SIZE = 30;
const BIAS_SIZE = 5;

enum ElementType {
  NODE, LINK
}

export interface InputFeature {
  f: (x: number, y: number) => number;
  label?: string;
}

export let INPUTS: {[name: string]: InputFeature} = {
  "x": {f: (x, y) => x, label: "X_1"},
  "y": {f: (x, y) => y, label: "X_2"},
  "xSquared": {f: (x, y) => x * x, label: "X_1^2"},
  "ySquared": {f: (x, y) => y * y,  label: "X_2^2"},
  "xTimesY": {f: (x, y) => x * y, label: "X_1X_2"},
  "sinX": {f: (x, y) => Math.sin(x), label: "sin(X_1)"},
  "sinY": {f: (x, y) => Math.sin(y), label: "sin(X_2)"},
};

export const enum Mode {
  None,
  DeleteEdge,
  AddEdge,
}

export let n: nn.Network = null;
export function setNetwork(network:nn.Network) {
  n = network;
}


class ElementUI {
  id: string;
  type:ElementType;
  links: string[] = [];
  cx :number;
  cy : number;

  constructor (id:string, type:ElementType, links:string[]) {
    this.id = id;
    this.type = type;
    this.links = links;
  }
};


export class NetworkUI {

  layout : ElementUI[][];
  nodeId2layer :{[id:string] : number} = {};
  id2pos : {[id:string] : any} = {};
  id2elem : {[id:string] : any} = {};
  maxY : number;

  updateMapping() {
    this.layout.forEach( function (layer, layerIdx) {
      layer.forEach(function (element, index) {
        this.nodeId2layer[element.id] = layerIdx;
        if (element.type == ElementType.NODE) {
          this.id2elem[element.id] = element;
          this.id2pos[element.id] = index;
        } else {
          element.links.forEach((linkId) => {

            if (!this.id2elem.hasOwnProperty(linkId)){
              this.id2elem[linkId] = {};
            }
            this.id2elem[linkId][layerIdx] = element;

            if (!this.id2pos.hasOwnProperty(linkId)){
              this.id2pos[linkId] = {};
            }
            this.id2pos[linkId][layerIdx] = index;

          }, this);
        }
      }, this);
    }, this);
  }


  getPosInLayer(link: nn.Link, layer:number) {

    if (this.nodeId2layer[link.source.id] == layer) {
      return this.id2pos[link.source.id];
    } else if (this.nodeId2layer[link.dest.id] == layer) {
      return this.id2pos[link.dest.id];
    }

    return this.id2pos[link.id][layer];
  }

  // recursive function to determine link ordering
  compareOrder(a, b, layer) {

    if (layer < 0 && a.dest.id != b.dest.id) {
      let compLayer = Math.min(this.nodeId2layer[a.dest.id], this.nodeId2layer[b.dest.id]);
      return this.compareOrder(a,b,compLayer);
    }

    if (layer < 0) throw new Error('recursion failed');

    let posA = this.getPosInLayer(a,layer);
    let posB = this.getPosInLayer(b,layer);

    if (posA != posB) return posA - posB;
    else return this.compareOrder(a,b,layer-1);

  }

  updateOrdering(){
    for (let i=1; i<this.layout.length; i++) {

      this.layout[i].forEach(function (element, index) {
        element.links.sort((a,b)=>{

          let linkA = nn.Link.id2Link[a];
          let linkB = nn.Link.id2Link[b];

          return this.compareOrder(linkA, linkB, i-1);

        });
      }, this);
    }
  }

  constructor (n: nn.Network, width:number) {

    // Draw the network layer by layer.
    let numLayers = n.network.length;
    let featureWidth = 118;
    let layerScale = d3.scale.ordinal<number, number>()
      .domain(d3.range(1, numLayers - 1))
      .rangePoints([featureWidth, width - RECT_SIZE], 0.7);
    let nodeIndexScale = (nodeIndex: number) => nodeIndex * (RECT_SIZE + 25);


    // create basic layout
    this.layout = n.network.map((layer, layerIdx) => {

      // do input layer separately
      if (layerIdx == 0 ) {
        return Object.keys(INPUTS).map((nodeId) => {
          return new ElementUI(nodeId, ElementType.NODE, []);
        });
      }

      return layer.map((node) => {
        let links = node.inputLinks.map((l)=>l.id);
        return new ElementUI(node.id, ElementType.NODE, links);
      });
    });
    this.updateMapping();

    // insert long links
    let posToAdd : any[] = this.layout.map(()=>{ return {}; });
    for (let j=0; j<n.longLinks.length; j++){
      let link = n.longLinks[j];
      let sourcePos = this.id2pos[link.source.id];
      let destPos = this.id2pos[link.dest.id];
      let pos = Math.round((sourcePos + destPos)/2);
      for (let i = link.sourceLayer()+1; i < link.destLayer(); i++) {
        if (!posToAdd[i].hasOwnProperty(pos)) {
          posToAdd[i][pos] = [];
        }
        posToAdd[i][pos].push(link);
      }
    }

    posToAdd.forEach(function (v , layerIdx) {

      if (Object.keys(v).length == 0) return;

      let posList = Object.keys(v).sort();

      posList.forEach((pos : string) => {
        // pos is above all others. add elements until we reach the right pos
        while  (!this.layout[layerIdx].hasOwnProperty(pos)) {
            let newElement = new ElementUI(null, ElementType.LINK, []);
            this.layout[layerIdx].push(newElement);
        }

        v[pos].forEach((link) => {
          let element = this.layout[layerIdx][pos];
          if (element.type == ElementType.LINK) {
            element.links.push(link.id);
          } else {
            let newElement = new ElementUI(null, ElementType.LINK,[link.id]);
            this.layout[layerIdx].splice(pos,0, newElement);
          }
        }, this);
      }, this);


    }, this);

    this.updateMapping();
    this.updateOrdering();

    // calculate coords for intermediate layers
    for (let layerIdx = 1; layerIdx < numLayers - 1; layerIdx++) {
      let cx = layerScale(layerIdx) + RECT_SIZE / 2;
      for (let i = 0; i < this.layout[layerIdx].length; i++) {
        let element = this.layout[layerIdx][i];
        element.cx = cx;
        element.cy = nodeIndexScale(i) + RECT_SIZE / 2;
      }
    }

    // calculate coords for input layers
    let nodeIds = Object.keys(INPUTS);
    let cx = RECT_SIZE / 2 + 50;
    nodeIds.forEach((nodeId, i) => {
      let cy = nodeIndexScale(i) + RECT_SIZE / 2;
      if (!this.id2elem.hasOwnProperty(nodeId)) {
        this.id2elem[nodeId] = new ElementUI(nodeId, ElementType.NODE,[]);
      }
      this.id2elem[nodeId].cx = cx;
      this.id2elem[nodeId].cy = cy;
    }, this);

    // calculate coords for output layer
    let node = n.network[numLayers - 1][0];
    this.id2elem[node.id].cx = width + RECT_SIZE / 2;
    this.id2elem[node.id].cy = nodeIndexScale(0) + RECT_SIZE / 2;

    this.maxY = Math.max(...(this.layout.map((layer) => nodeIndexScale(layer.length))));
    this.maxY = Math.max(this.maxY, nodeIndexScale(nodeIds.length));
  }
}



// Draw network
export function drawNetwork(n: nn.Network): void {
  let network: nn.Node[][] = n.network;
  let svg = d3.select("#svg");
  // Remove all svg elements.
  svg.select("g.core").remove();
  // Remove all div elements.
  d3.select("#network").selectAll("div.canvas").remove();
  d3.select("#network").selectAll("div.plus-minus-neurons").remove();

  // Get the width of the svg container.
  let padding = 3;
  let co = d3.select(".column.output").node() as HTMLDivElement;
  let cf = d3.select(".column.features").node() as HTMLDivElement;
  let width = co.offsetLeft - cf.offsetLeft;
  svg.attr("width", width);

  let container = svg.append("g")
    .classed("core", true)
    .attr("transform", `translate(${padding},${padding})`);
  // Draw the network layer by layer.
  let numLayers = n.network.length;
  let featureWidth = 118;
  let layerScale = d3.scale.ordinal<number, number>()
    .domain(d3.range(1, numLayers - 1))
    .rangePoints([featureWidth, width - RECT_SIZE], 0.7);


  let calloutThumb = d3.select(".callout.thumbnail").style("display", "none");
  let calloutWeights = d3.select(".callout.weights").style("display", "none");
  let netUI = new NetworkUI(n,width);

  // Draw the input layer separately.
  let nodeIds = Object.keys(INPUTS);
  nodeIds.forEach((nodeId, i) => {
    drawNode(netUI, nodeId, true, container);
  });

  // add control for layers
  d3.selectAll(".plus-minus-layers").remove();
  addLayerControl(1,layerScale(1) - 40);
  for (let layerIdx = 2; layerIdx < numLayers - 1; layerIdx++){
    let x = (layerScale(layerIdx) + layerScale(layerIdx-1))/2;
    addLayerControl(layerIdx,x);
  }
  addLayerControl(numLayers-1,layerScale(numLayers-2) + 40);


  // Draw links.
  for (let layerIdx = 1; layerIdx < numLayers - 1; layerIdx++) {
    let numNodes = network[layerIdx].length;
    for (let i = 0; i < numNodes; i++) {
      let node = network[layerIdx][i];
      for (let j = 0; j < node.inputLinks.length; j++) {
        let link = node.inputLinks[j];
        drawLink(link, netUI, container).node() as any;
      }
    }
  }

  // Draw the intermediate layers. Draw this after links so that it is on top
  for (let layerIdx = 1; layerIdx < numLayers - 1; layerIdx++) {
    let numNodes = network[layerIdx].length;
    addPlusMinusControl(layerScale(layerIdx), layerIdx, n);
    for (let i = 0; i < numNodes; i++) {
      let node = network[layerIdx][i]
      drawNode(netUI, node.id, false, container, node);
    }
  }


  // Output node is drawn separately
  let node = network[numLayers - 1][0];
  // add click listener
  d3.select('#heatmap').on('click', function(){
    if (mode == Mode.AddEdge) {
      selectNode(d3.select('#heatmap'), node);
    }
  });

  // Draw links to output.
  for (let i = 0; i < node.inputLinks.length; i++) {
    let link = node.inputLinks[i];
    drawLink(link, netUI, container);
  }

  // Adjust the height of the svg.
  svg.attr("height", netUI.maxY);

  // Adjust the height of the features column.
  let height = Math.max(
    getRelativeHeight(calloutThumb),
    getRelativeHeight(calloutWeights),
    getRelativeHeight(d3.select("#network"))
  );
  d3.select(".column.features").style("height", height + "px");
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
      reset();
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

    if (mode === Mode.DeleteEdge && nodeOrLink instanceof nn.Link) {
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

function drawLink(
  link: nn.Link, netUI: NetworkUI,
  container: d3.Selection<any>) {
  let line = container.insert("path", ":first-child");
  let source = netUI.id2elem[link.source.id];
  let dest = netUI.id2elem[link.dest.id];
  let offset = RECT_SIZE * 1.2;
  let dPath = null;

  let destInputLinks = netUI.id2elem[link.dest.id].links;
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
      let linkEle = netUI.id2elem[link.id][i];

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


    var lineFunction = d3.svg.line()
      .x(function(d) { return d[0]; })
      .y(function(d) { return d[1]; })
      .interpolate("basis");

    dPath = lineFunction(lineData);

  }

  // back-most line to show error rate
  line.attr({
    "d" : dPath,
    class: "errorlink",
    id: "errorline" + link.source.id + "-" + link.dest.id,
  });

  // line to show weights
  container.append("path").attr({
    "marker-start": "url(#markerArrow)",
    class: "link",
    id: "link" + link.source.id + "-" + link.dest.id,
    d: dPath
  });


  // Add an invisible thick link that will be used for showing the weight value on hover.
  // This has to be last so that it's on top.
  container.append("path")
    .attr("d", dPath)
    .attr("class", "link-hover")
    .on("mouseenter", function() {
      updateHoverCard(ElementType.LINK, link, d3.mouse(this));
    }).on("mouseleave", function() {
    updateHoverCard(null);
  });

  return line;
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
    if (selectedNodeLayer == nodeLayer || selectedNode.isLinked(node)) {
      d3.select('#info').text('Cannot create link. Invalid target.');
      return;
    }

    let fromNode = selectedNodeLayer < nodeLayer ? selectedNode : node;
    let toNode = selectedNodeLayer > nodeLayer ? selectedNode : node;
    n.addLink(fromNode, toNode);
    d3.select('#info').text('Link between nodes ' + node.id + ' and ' + selectedNode.id + ' created.');
    selectedNode = null;
    selectedDiv.classed("selected", false);
    selectedDiv = null;
    reset();
  }
}


function drawNode(netUI:NetworkUI, nodeId: string, isInput: boolean,
                  container: d3.Selection<any>, node?: nn.Node) {
  let element = netUI.id2elem[nodeId];
  let x = element.cx - RECT_SIZE / 2;
  let y = element.cy - RECT_SIZE / 2;

  let nodeGroup = container.append("g")
    .attr({
      "class": "node",
      "id": `node${nodeId}`,
      "transform": `translate(${x},${y})`
    });

  // Draw the main rectangle.
  nodeGroup.append("rect")
    .attr({
      x: 0,
      y: 0,
      width: RECT_SIZE,
      height: RECT_SIZE,
    });
  let activeOrNotClass = state[nodeId] ? "active" : "inactive";

  if (isInput) {
    let label = INPUTS[nodeId].label != null ?
      INPUTS[nodeId].label : nodeId;
    // Draw the input label.
    let text = nodeGroup.append("text").attr({
      class: "main-label",
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

  if (!isInput) {
    // draw the option labels
    let text = nodeGroup.append("text").attr({
      class: "option-label",
      x: 0,
      y: RECT_SIZE + 13,
      "text-anchor": "start"
    });
    text.append("tspan").text('Remove');
    text.on("click", function() {
      n.removeNode(node);
      reset();
    });
    text.style("cursor", "pointer");


    let errorText = nodeGroup.append("text").attr({
      class: "option-label",
      id: `error-${nodeId}`,
      x: RECT_SIZE + 7,
      y: RECT_SIZE - 4,
      "text-anchor": "start"
    });
    errorText.text('Error:');

  }

  if (!isInput) {
    // Draw the node's bias.
    nodeGroup.append("rect")
      .attr({
        id: `bias-${nodeId}`,
        x: -BIAS_SIZE - 2,
        y: RECT_SIZE - BIAS_SIZE + 3,
        width: BIAS_SIZE,
        height: BIAS_SIZE,
      }).on("mouseenter", function() {
      updateHoverCard(ElementType.NODE, node, d3.mouse(container.node()));
    }).on("mouseleave", function() {
      updateHoverCard(null);
    });
  }

  // Draw the node's canvas.
  let div = d3.select("#network").insert("div", ":first-child")
    .attr({
      "id": `canvas-${nodeId}`,
      "class": "canvas"
    })
    .style({
      position: "absolute",
      left: `${x + 3}px`,
      top: `${y + 3}px`
    })
    .on("mouseenter", function() {
      selectedNodeId = nodeId;
      div.classed("hovered", true);
      nodeGroup.classed("hovered", true);
      updateDecisionBoundary(n.network, false);
      heatMap.updateBackground(boundary[nodeId], state.discretize);
    })
    .on("mouseleave", function() {
      selectedNodeId = null;
      div.classed("hovered", false);
      nodeGroup.classed("hovered", false);
      updateDecisionBoundary(n.network, false);
      heatMap.updateBackground(boundary[n.getOutputNode().id],
        state.discretize);
    })
    .on("click", function(){
      if (mode == Mode.AddEdge) {
        selectNode(div, node);
      }
    });

  if (isInput) {
    div.on("click", function() {

      if (mode == Mode.AddEdge) {
        selectNode(div, n.findNode(nodeId));
        return;
      }

      // add or remove input node
      state[nodeId] = !state[nodeId];
      if (state[nodeId]) {
        n.addInput(nodeId);
      } else {
        n.removeNode(n.findNode(nodeId));
      }

      reset();
    });
    div.style("cursor", "pointer");
  }
  if (isInput) {
    div.classed(activeOrNotClass, true);
  }
  let nodeHeatMap = new HeatMap(RECT_SIZE, DENSITY / 10, xDomain,
    xDomain, div, {noSvg: true});
  div.datum({heatmap: nodeHeatMap, id: nodeId});

}