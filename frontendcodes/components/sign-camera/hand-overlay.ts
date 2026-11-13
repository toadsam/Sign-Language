export const HAND_EDGES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]] as const;
export function fitPoint(x:number,y:number,sourceWidth:number,sourceHeight:number,width:number,height:number){
  const scale=Math.min(width/sourceWidth,height/sourceHeight);
  return {x:(width-sourceWidth*scale)/2+x*sourceWidth*scale,y:(height-sourceHeight*scale)/2+y*sourceHeight*scale};
}
