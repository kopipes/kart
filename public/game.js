// Keep the original 2D view available for browsers without WebGL2.
if (document.createElement('canvas').getContext('webgl2')) {
  import('/game3d.js').catch(async error => {
    console.error('3D renderer unavailable, loading 2D view', error);
    const canvas = document.getElementById('gameCanvas');
    canvas.replaceWith(canvas.cloneNode(true));
    await import('/game2d.js');
  });
} else {
  import('/game2d.js');
}
