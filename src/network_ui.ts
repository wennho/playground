import * as nn from "./nn"
import {INPUTS} from "./common";

export const RECT_SIZE = 30;

export enum ElementType {
  NODE, LINK
}

export class ElementUI {
  id: string;
  type:ElementType;
  links: string[] = [];
  cx :number;
  cy : number;
  isInput: boolean = false;

  constructor (id:string, type:ElementType, links:string[]) {
    this.id = id;
    this.type = type;
    this.links = links;
  }
}

export class NetworkUI {

  layout : ElementUI[][];
  nodeId2layer :{[id:string] : number} = {};
  id2pos : {[id:string] : any} = {};
  id2elem : {[id:string] : any} = {};
  maxY : number;
  nodes : ElementUI[] = [];

  updateNodeList() {
    for (let i=0; i<this.layout.length;i++) {
      for (let j=0; j<this.layout[i].length;j++) {
        let ele = this.layout[i][j];
        if (ele.type == ElementType.NODE) {
          this.nodes.push(this.layout[i][j]);
        }
      }
    }
  }

  // update the id2elem and id2pos mappings
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

  // sort the link ordering that goes to each element
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

  constructor (n: nn.Network, width:number, oldNetUI?:NetworkUI) {

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
          let ele = new ElementUI(nodeId, ElementType.NODE, []);
          ele.isInput = true;
          return ele;
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

    this.updateNodeList();
  }
}
