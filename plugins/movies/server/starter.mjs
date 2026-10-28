/** An editorial starting collection, not a popularity or availability feed.
 * Short descriptions are original recommendations; links provide film details. */
const films=[
  ['arrival-2016','Arrival',2016,['Science-Fiction','Drama'],'A thoughtful first-contact mystery for an evening of big ideas.','Arrival_(film)'],
  ['blade-runner-2049','Blade Runner 2049',2017,['Science-Fiction','Thriller'],'A patient, atmospheric mystery in a spectacular future city.','Blade_Runner_2049'],
  ['interstellar','Interstellar',2014,['Science-Fiction','Drama'],'An expansive space journey with a very human story at its centre.','Interstellar_(film)'],
  ['the-martian','The Martian',2015,['Science-Fiction','Adventure'],'Optimistic problem-solving and survival, one impossible task at a time.','The_Martian_(film)'],
  ['dune-2021','Dune',2021,['Science-Fiction','Adventure'],'A large-scale desert-world adventure with a striking sense of place.','Dune_(2021_film)'],
  ['grand-budapest','The Grand Budapest Hotel',2014,['Comedy','Adventure'],'An intricately designed caper with dry humour and colourful characters.','The_Grand_Budapest_Hotel'],
  ['knives-out','Knives Out',2019,['Mystery','Comedy'],'A playful modern whodunit for a twist-filled evening.','Knives_Out'],
  ['everything-everywhere','Everything Everywhere All at Once',2022,['Science-Fiction','Comedy'],'An energetic, strange and heartfelt trip through alternate possibilities.','Everything_Everywhere_All_at_Once'],
  ['truman-show','The Truman Show',1998,['Drama','Comedy'],'A sharply observed story about ordinary life under extraordinary scrutiny.','The_Truman_Show'],
  ['mad-max-fury-road','Mad Max: Fury Road',2015,['Action','Adventure'],'A propulsive chase built around practical spectacle and visual storytelling.','Mad_Max:_Fury_Road'],
  ['spirited-away','Spirited Away',2001,['Animation','Fantasy'],'An imaginative journey into an unfamiliar world, rich in atmosphere.','Spirited_Away'],
  ['the-prestige','The Prestige',2006,['Mystery','Drama'],'An absorbing puzzle about rivalry, obsession and the price of a trick.','The_Prestige_(film)'],
  ['edge-of-tomorrow','Edge of Tomorrow',2014,['Science-Fiction','Action'],'A brisk science-fiction action film with a clever repeating-day hook.','Edge_of_Tomorrow'],
  ['moon','Moon',2009,['Science-Fiction','Mystery'],'A compact, reflective lunar mystery with a strong central performance.','Moon_(2009_film)'],
  ['ex-machina','Ex Machina',2014,['Science-Fiction','Thriller'],'A restrained chamber thriller about intelligence, trust and control.','Ex_Machina_(film)'],
  ['hunt-wilderpeople','Hunt for the Wilderpeople',2016,['Comedy','Adventure'],'A warm, offbeat wilderness adventure with an unlikely partnership.','Hunt_for_the_Wilderpeople'],
];
export const starter=films.map(([id,title,year,genres,summary,page])=>({id:'starter-'+id,title,year,genres,summary,url:'https://en.wikipedia.org/wiki/'+page,source:'Sormus starter collection',releaseDate:'',rating:null}));
