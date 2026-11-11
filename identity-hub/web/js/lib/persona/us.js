// Data for made-up details in the United States.
// The names are common names. First and last names are picked independently.
// City, state, and ZIP code are real and belong together. The street is invented.
// This file has data and one function. It uses no browser feature and no network.

// Common first names in the US, from many origins.
export const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Linda', 'Michael', 'Barbara', 'David', 'Elizabeth',
  'William', 'Susan', 'Richard', 'Jessica', 'Leonard', 'Sarah', 'Thomas', 'Karen', 'Charles', 'Nancy',
  'Christopher', 'Lisa', 'Daniel', 'Ruth', 'Matthew', 'Margaret', 'Anthony', 'Sandra', 'Mark', 'Ashley',
  'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle', 'Kenneth', 'Carol',
  'Kevin', 'Amanda', 'Brian', 'Melissa', 'Harold', 'Deborah', 'Timothy', 'Stephanie', 'Ronald', 'Rebecca',
  'Edward', 'Laura', 'Jason', 'Sharon', 'Jeffrey', 'Cynthia', 'Ryan', 'Joyce', 'Jacob', 'Amy',
  'Keith', 'Monica', 'Nicholas', 'Anna', 'Eric', 'Brenda', 'Jonathan', 'Teresa', 'Douglas', 'Nicole',
  'Larry', 'Samantha', 'Justin', 'Katherine', 'Scott', 'Christine', 'Brandon', 'Rachel', 'Benjamin', 'Carolyn',
  'Samuel', 'Janet', 'Gregory', 'Maria', 'Alexander', 'Heather', 'Patrick', 'Diane', 'Frank', 'Julie',
  'Raymond', 'Victoria', 'Victor', 'Kelly', 'Dennis', 'Christina', 'Aaron', 'Lauren', 'Jose', 'Olivia',
  'Nathan', 'Megan', 'Henry', 'Andrea', 'Zachary', 'Hannah', 'Kyle', 'Sofia', 'Noah', 'Isabella',
  'Ethan', 'Camila', 'Carlos', 'Gabriela', 'Luis', 'Lucia', 'Juan', 'Elena', 'Miguel', 'Rosa',
  'Mateo', 'Mei', 'Wei', 'Yuki', 'Hiroshi', 'Linh', 'Minh', 'Priya', 'Raj', 'Neha',
  'Arjun', 'Layla', 'Sanjay', 'Amina', 'Omar', 'Fatima', 'Yusuf', 'Aaliyah', 'Hassan', 'Keisha',
  'Malik', 'Imani', 'Darnell', 'Nadia', 'Jamal', 'Chloe', 'Andre', 'Stella', 'Ivan', 'Zoe',
  'Dmitri', 'Maya', 'Liam', 'Clara', 'Caleb', 'Ruby', 'Lucas', 'Irene',
];

// Common last names in the US, from many origins.
// Some very common names are left out on purpose, because with a common first name
// they give the name of a very famous person.
export const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez',
  'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Young', 'Allen', 'Wright', 'Torres',
  'Nguyen', 'Hill', 'Flores', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Roberts',
  'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Morales',
  'Murphy', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson', 'Bailey', 'Reed', 'Howard', 'Ramos',
  'Kim', 'Cox', 'Ward', 'Richardson', 'Brooks', 'Chavez', 'Wood', 'Bennett', 'Gray', 'Mendoza',
  'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Long', 'Ross', 'Foster',
  'Jimenez', 'Powell', 'Jenkins', 'Russell', 'Sullivan', 'Coleman', 'Butler', 'Henderson', 'Barnes', 'Fisher',
  'Vasquez', 'Romero', 'Griffin', 'Moreno', 'West', 'Bryant', 'Herrera', 'Gibson', 'Ellis', 'Tran',
  'Medina', 'Stevens', 'Castro', 'Marshall', 'Owens', 'Fernandez', 'Wells', 'Vargas', 'Chen', 'Freeman',
  'Webb', 'Tucker', 'Guzman', 'Crawford', 'Porter', 'Hunter', 'Gordon', 'Mendez', 'Silva', 'Shaw',
  'Dixon', 'Munoz', 'Hicks', 'Robertson', 'Boyd', 'Salazar', 'Mills', 'Garza', 'Nichols', 'Weaver',
  'Gardner', 'Dunn', 'Singh', 'Vega', 'Wong', 'Khan', "O'Brien", 'Hoffman', 'Delgado', 'Liu',
  'Lin', 'Huang', 'Zhang', 'Pham', 'Sharma', 'Rahman', 'Ibrahim', 'Rossi', 'Novak', 'Keller',
  'Weber', 'Jensen', 'Larson', 'Carlson', 'Rios', 'Santiago', 'Molina', 'Contreras', 'Guerrero', 'Sandoval',
  'Dominguez', 'Espinoza', 'Maldonado', 'Okafor', 'Mensah', 'Kowalski', 'Tanaka', 'Nakamura', 'Petrov', 'Haddad',
  'Ahmed',
];

export const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// The first three digits of the ZIP codes of each state, as ranges [from, to].
// This table was written from the postal ranges, not from the city list below.
// The tests use it to cross-check every ZIP code of the city list.
export const ZIP_PREFIXES = {
  AL: [[350, 369]],
  AK: [[995, 999]],
  AZ: [[850, 865]],
  AR: [[716, 729]],
  CA: [[900, 961]],
  CO: [[800, 816]],
  CT: [[60, 69]],
  DE: [[197, 199]],
  DC: [[200, 200], [202, 205]],
  FL: [[320, 339], [341, 342], [344, 344], [346, 347], [349, 349]],
  GA: [[300, 319], [398, 399]],
  HI: [[967, 968]],
  ID: [[832, 838]],
  IL: [[600, 629]],
  IN: [[460, 479]],
  IA: [[500, 528]],
  KS: [[660, 679]],
  KY: [[400, 427]],
  LA: [[700, 714]],
  ME: [[39, 49]],
  MD: [[206, 219]],
  MA: [[10, 27], [55, 55]],
  MI: [[480, 499]],
  MN: [[550, 567]],
  MS: [[386, 397]],
  MO: [[630, 658]],
  MT: [[590, 599]],
  NE: [[680, 693]],
  NV: [[889, 898]],
  NH: [[30, 38]],
  NJ: [[70, 89]],
  NM: [[870, 884]],
  NY: [[5, 5], [63, 63], [100, 149]],
  NC: [[270, 289]],
  ND: [[580, 588]],
  OH: [[430, 459]],
  OK: [[730, 732], [734, 749]],
  OR: [[970, 979]],
  PA: [[150, 196]],
  RI: [[28, 29]],
  SC: [[290, 299]],
  SD: [[570, 577]],
  TN: [[370, 385]],
  TX: [[733, 733], [750, 799], [885, 885]],
  UT: [[840, 847]],
  VT: [[50, 54], [56, 59]],
  VA: [[201, 201], [220, 246]],
  WA: [[980, 994]],
  WV: [[247, 268]],
  WI: [[530, 549]],
  WY: [[820, 831]],
};

// Real cities with ZIP codes that belong to them. Mostly the central ZIP codes of well-known cities.
// Rule for changes: add a ZIP code only if you are sure that it belongs to the city. If in doubt, leave it out.
export const CITIES = [
  // Alabama
  { city: 'Birmingham', state: 'AL', zips: ['35203', '35205'] },
  { city: 'Montgomery', state: 'AL', zips: ['36104', '36106'] },
  { city: 'Mobile', state: 'AL', zips: ['36602', '36604'] },
  { city: 'Huntsville', state: 'AL', zips: ['35801'] },
  // Alaska
  { city: 'Anchorage', state: 'AK', zips: ['99501', '99503'] },
  { city: 'Fairbanks', state: 'AK', zips: ['99701'] },
  { city: 'Juneau', state: 'AK', zips: ['99801'] },
  // Arizona
  { city: 'Phoenix', state: 'AZ', zips: ['85003', '85004'] },
  { city: 'Tucson', state: 'AZ', zips: ['85701', '85705'] },
  { city: 'Tempe', state: 'AZ', zips: ['85281'] },
  { city: 'Scottsdale', state: 'AZ', zips: ['85251'] },
  { city: 'Mesa', state: 'AZ', zips: ['85201'] },
  { city: 'Flagstaff', state: 'AZ', zips: ['86001'] },
  // Arkansas
  { city: 'Little Rock', state: 'AR', zips: ['72201', '72202'] },
  { city: 'Fayetteville', state: 'AR', zips: ['72701'] },
  { city: 'Fort Smith', state: 'AR', zips: ['72901'] },
  // California
  { city: 'Los Angeles', state: 'CA', zips: ['90012', '90013', '90017'] },
  { city: 'San Francisco', state: 'CA', zips: ['94102', '94103', '94109'] },
  { city: 'San Diego', state: 'CA', zips: ['92101', '92103'] },
  { city: 'Sacramento', state: 'CA', zips: ['95814', '95816'] },
  { city: 'San Jose', state: 'CA', zips: ['95112', '95113'] },
  { city: 'Oakland', state: 'CA', zips: ['94607', '94612'] },
  { city: 'Fresno', state: 'CA', zips: ['93721'] },
  { city: 'Long Beach', state: 'CA', zips: ['90802'] },
  { city: 'Pasadena', state: 'CA', zips: ['91101'] },
  { city: 'Santa Barbara', state: 'CA', zips: ['93101'] },
  { city: 'Berkeley', state: 'CA', zips: ['94704'] },
  { city: 'Bakersfield', state: 'CA', zips: ['93301'] },
  // Colorado
  { city: 'Denver', state: 'CO', zips: ['80202', '80203'] },
  { city: 'Colorado Springs', state: 'CO', zips: ['80903'] },
  { city: 'Boulder', state: 'CO', zips: ['80302'] },
  { city: 'Fort Collins', state: 'CO', zips: ['80521', '80524'] },
  { city: 'Pueblo', state: 'CO', zips: ['81003'] },
  // Connecticut
  { city: 'Hartford', state: 'CT', zips: ['06103', '06106'] },
  { city: 'New Haven', state: 'CT', zips: ['06510', '06511'] },
  { city: 'Stamford', state: 'CT', zips: ['06901'] },
  { city: 'Bridgeport', state: 'CT', zips: ['06604'] },
  // Delaware
  { city: 'Wilmington', state: 'DE', zips: ['19801'] },
  { city: 'Dover', state: 'DE', zips: ['19901'] },
  { city: 'Newark', state: 'DE', zips: ['19711'] },
  // District of Columbia
  { city: 'Washington', state: 'DC', zips: ['20001', '20002', '20009'] },
  // Florida
  { city: 'Miami', state: 'FL', zips: ['33130', '33131'] },
  { city: 'Orlando', state: 'FL', zips: ['32801'] },
  { city: 'Tampa', state: 'FL', zips: ['33602'] },
  { city: 'Jacksonville', state: 'FL', zips: ['32202'] },
  { city: 'Tallahassee', state: 'FL', zips: ['32301'] },
  { city: 'St. Petersburg', state: 'FL', zips: ['33701'] },
  { city: 'Fort Lauderdale', state: 'FL', zips: ['33301'] },
  { city: 'Gainesville', state: 'FL', zips: ['32601'] },
  { city: 'Pensacola', state: 'FL', zips: ['32501'] },
  // Georgia
  { city: 'Atlanta', state: 'GA', zips: ['30303', '30308'] },
  { city: 'Savannah', state: 'GA', zips: ['31401'] },
  { city: 'Augusta', state: 'GA', zips: ['30901'] },
  { city: 'Athens', state: 'GA', zips: ['30601'] },
  { city: 'Macon', state: 'GA', zips: ['31201'] },
  { city: 'Columbus', state: 'GA', zips: ['31901'] },
  // Hawaii
  { city: 'Honolulu', state: 'HI', zips: ['96813', '96814', '96815'] },
  { city: 'Hilo', state: 'HI', zips: ['96720'] },
  { city: 'Kailua', state: 'HI', zips: ['96734'] },
  // Idaho
  { city: 'Boise', state: 'ID', zips: ['83702'] },
  { city: 'Idaho Falls', state: 'ID', zips: ['83402'] },
  { city: 'Pocatello', state: 'ID', zips: ['83201'] },
  { city: "Coeur d'Alene", state: 'ID', zips: ['83814'] },
  // Illinois
  { city: 'Chicago', state: 'IL', zips: ['60601', '60602', '60611'] },
  { city: 'Springfield', state: 'IL', zips: ['62701'] },
  { city: 'Peoria', state: 'IL', zips: ['61602'] },
  { city: 'Rockford', state: 'IL', zips: ['61101'] },
  { city: 'Evanston', state: 'IL', zips: ['60201'] },
  { city: 'Naperville', state: 'IL', zips: ['60540'] },
  { city: 'Champaign', state: 'IL', zips: ['61820'] },
  // Indiana
  { city: 'Indianapolis', state: 'IN', zips: ['46204'] },
  { city: 'Fort Wayne', state: 'IN', zips: ['46802'] },
  { city: 'South Bend', state: 'IN', zips: ['46601'] },
  { city: 'Bloomington', state: 'IN', zips: ['47401'] },
  { city: 'Evansville', state: 'IN', zips: ['47708'] },
  // Iowa
  { city: 'Des Moines', state: 'IA', zips: ['50309'] },
  { city: 'Cedar Rapids', state: 'IA', zips: ['52401'] },
  { city: 'Iowa City', state: 'IA', zips: ['52240'] },
  { city: 'Davenport', state: 'IA', zips: ['52801'] },
  { city: 'Sioux City', state: 'IA', zips: ['51101'] },
  // Kansas
  { city: 'Wichita', state: 'KS', zips: ['67202'] },
  { city: 'Topeka', state: 'KS', zips: ['66603'] },
  { city: 'Lawrence', state: 'KS', zips: ['66044'] },
  { city: 'Kansas City', state: 'KS', zips: ['66101'] },
  { city: 'Manhattan', state: 'KS', zips: ['66502'] },
  // Kentucky
  { city: 'Louisville', state: 'KY', zips: ['40202'] },
  { city: 'Lexington', state: 'KY', zips: ['40507'] },
  { city: 'Frankfort', state: 'KY', zips: ['40601'] },
  { city: 'Bowling Green', state: 'KY', zips: ['42101'] },
  // Louisiana
  { city: 'New Orleans', state: 'LA', zips: ['70112', '70130'] },
  { city: 'Baton Rouge', state: 'LA', zips: ['70801', '70802'] },
  { city: 'Shreveport', state: 'LA', zips: ['71101'] },
  { city: 'Lafayette', state: 'LA', zips: ['70501'] },
  // Maine
  { city: 'Portland', state: 'ME', zips: ['04101'] },
  { city: 'Augusta', state: 'ME', zips: ['04330'] },
  { city: 'Bangor', state: 'ME', zips: ['04401'] },
  // Maryland
  { city: 'Baltimore', state: 'MD', zips: ['21201', '21202'] },
  { city: 'Annapolis', state: 'MD', zips: ['21401'] },
  { city: 'Frederick', state: 'MD', zips: ['21701'] },
  { city: 'Rockville', state: 'MD', zips: ['20850'] },
  { city: 'Silver Spring', state: 'MD', zips: ['20910'] },
  // Massachusetts
  { city: 'Boston', state: 'MA', zips: ['02108', '02116'] },
  { city: 'Cambridge', state: 'MA', zips: ['02138', '02139'] },
  { city: 'Worcester', state: 'MA', zips: ['01608'] },
  { city: 'Springfield', state: 'MA', zips: ['01103'] },
  { city: 'Lowell', state: 'MA', zips: ['01852'] },
  // Michigan
  { city: 'Detroit', state: 'MI', zips: ['48201', '48226'] },
  { city: 'Grand Rapids', state: 'MI', zips: ['49503'] },
  { city: 'Ann Arbor', state: 'MI', zips: ['48104'] },
  { city: 'Lansing', state: 'MI', zips: ['48933'] },
  { city: 'Kalamazoo', state: 'MI', zips: ['49007'] },
  { city: 'Flint', state: 'MI', zips: ['48502'] },
  // Minnesota
  { city: 'Minneapolis', state: 'MN', zips: ['55401', '55402'] },
  { city: 'Saint Paul', state: 'MN', zips: ['55101', '55102'] },
  { city: 'Duluth', state: 'MN', zips: ['55802'] },
  { city: 'Rochester', state: 'MN', zips: ['55902'] },
  // Mississippi
  { city: 'Jackson', state: 'MS', zips: ['39201'] },
  { city: 'Gulfport', state: 'MS', zips: ['39501'] },
  { city: 'Hattiesburg', state: 'MS', zips: ['39401'] },
  { city: 'Biloxi', state: 'MS', zips: ['39530'] },
  // Missouri
  { city: 'Kansas City', state: 'MO', zips: ['64105', '64106'] },
  { city: 'St. Louis', state: 'MO', zips: ['63101', '63103'] },
  { city: 'Springfield', state: 'MO', zips: ['65806'] },
  { city: 'Columbia', state: 'MO', zips: ['65201'] },
  { city: 'Jefferson City', state: 'MO', zips: ['65101'] },
  // Montana
  { city: 'Billings', state: 'MT', zips: ['59101'] },
  { city: 'Missoula', state: 'MT', zips: ['59801', '59802'] },
  { city: 'Helena', state: 'MT', zips: ['59601'] },
  { city: 'Bozeman', state: 'MT', zips: ['59715'] },
  { city: 'Great Falls', state: 'MT', zips: ['59401'] },
  // Nebraska
  { city: 'Omaha', state: 'NE', zips: ['68102'] },
  { city: 'Lincoln', state: 'NE', zips: ['68508'] },
  { city: 'Grand Island', state: 'NE', zips: ['68801'] },
  // Nevada
  { city: 'Las Vegas', state: 'NV', zips: ['89101'] },
  { city: 'Reno', state: 'NV', zips: ['89501'] },
  { city: 'Carson City', state: 'NV', zips: ['89701'] },
  { city: 'Henderson', state: 'NV', zips: ['89015'] },
  // New Hampshire
  { city: 'Manchester', state: 'NH', zips: ['03101'] },
  { city: 'Concord', state: 'NH', zips: ['03301'] },
  { city: 'Nashua', state: 'NH', zips: ['03060'] },
  { city: 'Portsmouth', state: 'NH', zips: ['03801'] },
  // New Jersey
  { city: 'Newark', state: 'NJ', zips: ['07102'] },
  { city: 'Jersey City', state: 'NJ', zips: ['07302'] },
  { city: 'Trenton', state: 'NJ', zips: ['08608'] },
  { city: 'Princeton', state: 'NJ', zips: ['08540'] },
  { city: 'Hoboken', state: 'NJ', zips: ['07030'] },
  { city: 'Atlantic City', state: 'NJ', zips: ['08401'] },
  // New Mexico
  { city: 'Albuquerque', state: 'NM', zips: ['87102'] },
  { city: 'Santa Fe', state: 'NM', zips: ['87501'] },
  { city: 'Las Cruces', state: 'NM', zips: ['88001'] },
  { city: 'Roswell', state: 'NM', zips: ['88201'] },
  // New York
  { city: 'New York', state: 'NY', zips: ['10001', '10011', '10019'] },
  { city: 'Brooklyn', state: 'NY', zips: ['11201', '11215'] },
  { city: 'Buffalo', state: 'NY', zips: ['14202'] },
  { city: 'Rochester', state: 'NY', zips: ['14604'] },
  { city: 'Albany', state: 'NY', zips: ['12207'] },
  { city: 'Syracuse', state: 'NY', zips: ['13202'] },
  { city: 'Ithaca', state: 'NY', zips: ['14850'] },
  { city: 'Yonkers', state: 'NY', zips: ['10701'] },
  // North Carolina
  { city: 'Charlotte', state: 'NC', zips: ['28202'] },
  { city: 'Raleigh', state: 'NC', zips: ['27601'] },
  { city: 'Durham', state: 'NC', zips: ['27701'] },
  { city: 'Greensboro', state: 'NC', zips: ['27401'] },
  { city: 'Asheville', state: 'NC', zips: ['28801'] },
  { city: 'Wilmington', state: 'NC', zips: ['28401'] },
  { city: 'Winston-Salem', state: 'NC', zips: ['27101'] },
  { city: 'Chapel Hill', state: 'NC', zips: ['27514'] },
  // North Dakota
  { city: 'Fargo', state: 'ND', zips: ['58102'] },
  { city: 'Bismarck', state: 'ND', zips: ['58501'] },
  { city: 'Grand Forks', state: 'ND', zips: ['58201'] },
  { city: 'Minot', state: 'ND', zips: ['58701'] },
  // Ohio
  { city: 'Columbus', state: 'OH', zips: ['43215'] },
  { city: 'Cleveland', state: 'OH', zips: ['44113', '44114'] },
  { city: 'Cincinnati', state: 'OH', zips: ['45202'] },
  { city: 'Toledo', state: 'OH', zips: ['43604'] },
  { city: 'Akron', state: 'OH', zips: ['44308'] },
  { city: 'Dayton', state: 'OH', zips: ['45402'] },
  // Oklahoma
  { city: 'Oklahoma City', state: 'OK', zips: ['73102'] },
  { city: 'Tulsa', state: 'OK', zips: ['74103'] },
  { city: 'Norman', state: 'OK', zips: ['73069'] },
  // Oregon
  { city: 'Portland', state: 'OR', zips: ['97204', '97205', '97209'] },
  { city: 'Eugene', state: 'OR', zips: ['97401'] },
  { city: 'Salem', state: 'OR', zips: ['97301'] },
  { city: 'Bend', state: 'OR', zips: ['97701'] },
  { city: 'Corvallis', state: 'OR', zips: ['97330'] },
  // Pennsylvania
  { city: 'Philadelphia', state: 'PA', zips: ['19102', '19103', '19107'] },
  { city: 'Pittsburgh', state: 'PA', zips: ['15213', '15222'] },
  { city: 'Harrisburg', state: 'PA', zips: ['17101'] },
  { city: 'Allentown', state: 'PA', zips: ['18101'] },
  { city: 'Erie', state: 'PA', zips: ['16501'] },
  { city: 'Scranton', state: 'PA', zips: ['18503'] },
  { city: 'Lancaster', state: 'PA', zips: ['17602'] },
  // Rhode Island
  { city: 'Providence', state: 'RI', zips: ['02903'] },
  { city: 'Newport', state: 'RI', zips: ['02840'] },
  { city: 'Warwick', state: 'RI', zips: ['02886'] },
  // South Carolina
  { city: 'Charleston', state: 'SC', zips: ['29401'] },
  { city: 'Columbia', state: 'SC', zips: ['29201'] },
  { city: 'Greenville', state: 'SC', zips: ['29601'] },
  { city: 'Myrtle Beach', state: 'SC', zips: ['29577'] },
  // South Dakota
  { city: 'Sioux Falls', state: 'SD', zips: ['57104'] },
  { city: 'Rapid City', state: 'SD', zips: ['57701'] },
  { city: 'Pierre', state: 'SD', zips: ['57501'] },
  // Tennessee
  { city: 'Nashville', state: 'TN', zips: ['37201', '37203'] },
  { city: 'Memphis', state: 'TN', zips: ['38103'] },
  { city: 'Knoxville', state: 'TN', zips: ['37902'] },
  { city: 'Chattanooga', state: 'TN', zips: ['37402'] },
  // Texas
  { city: 'Austin', state: 'TX', zips: ['78701', '78704'] },
  { city: 'Houston', state: 'TX', zips: ['77002'] },
  { city: 'Dallas', state: 'TX', zips: ['75201'] },
  { city: 'San Antonio', state: 'TX', zips: ['78205'] },
  { city: 'Fort Worth', state: 'TX', zips: ['76102'] },
  { city: 'El Paso', state: 'TX', zips: ['79901'] },
  { city: 'Lubbock', state: 'TX', zips: ['79401'] },
  { city: 'Amarillo', state: 'TX', zips: ['79101'] },
  { city: 'Corpus Christi', state: 'TX', zips: ['78401'] },
  { city: 'Waco', state: 'TX', zips: ['76701'] },
  { city: 'Plano', state: 'TX', zips: ['75074'] },
  // Utah
  { city: 'Salt Lake City', state: 'UT', zips: ['84101', '84111'] },
  { city: 'Provo', state: 'UT', zips: ['84601'] },
  { city: 'Ogden', state: 'UT', zips: ['84401'] },
  { city: 'St. George', state: 'UT', zips: ['84770'] },
  // Vermont
  { city: 'Burlington', state: 'VT', zips: ['05401'] },
  { city: 'Montpelier', state: 'VT', zips: ['05602'] },
  { city: 'Rutland', state: 'VT', zips: ['05701'] },
  { city: 'Brattleboro', state: 'VT', zips: ['05301'] },
  // Virginia
  { city: 'Richmond', state: 'VA', zips: ['23219', '23220'] },
  { city: 'Norfolk', state: 'VA', zips: ['23510'] },
  { city: 'Virginia Beach', state: 'VA', zips: ['23451'] },
  { city: 'Arlington', state: 'VA', zips: ['22201'] },
  { city: 'Alexandria', state: 'VA', zips: ['22314'] },
  { city: 'Charlottesville', state: 'VA', zips: ['22902'] },
  { city: 'Roanoke', state: 'VA', zips: ['24011'] },
  // Washington
  { city: 'Seattle', state: 'WA', zips: ['98101', '98104'] },
  { city: 'Spokane', state: 'WA', zips: ['99201'] },
  { city: 'Tacoma', state: 'WA', zips: ['98402'] },
  { city: 'Olympia', state: 'WA', zips: ['98501'] },
  { city: 'Bellevue', state: 'WA', zips: ['98004'] },
  { city: 'Bellingham', state: 'WA', zips: ['98225'] },
  { city: 'Vancouver', state: 'WA', zips: ['98660'] },
  // West Virginia
  { city: 'Charleston', state: 'WV', zips: ['25301'] },
  { city: 'Morgantown', state: 'WV', zips: ['26505'] },
  { city: 'Huntington', state: 'WV', zips: ['25701'] },
  // Wisconsin
  { city: 'Milwaukee', state: 'WI', zips: ['53202'] },
  { city: 'Madison', state: 'WI', zips: ['53703'] },
  { city: 'Green Bay', state: 'WI', zips: ['54301'] },
  { city: 'Eau Claire', state: 'WI', zips: ['54701'] },
  { city: 'La Crosse', state: 'WI', zips: ['54601'] },
  // Wyoming
  { city: 'Cheyenne', state: 'WY', zips: ['82001'] },
  { city: 'Casper', state: 'WY', zips: ['82601'] },
  { city: 'Laramie', state: 'WY', zips: ['82070'] },
  { city: 'Jackson', state: 'WY', zips: ['83001'] },
];

// Invented street names have two words. The words are not the usual words of real street names
// (no "Main", no tree names that every town has, no numbers), so a result is unlikely to be a real street.
export const STREET_FIRST = [
  'Quiet', 'Amber', 'Larkspur', 'Russet', 'Juniper', 'Bramble', 'Indigo', 'Ivory', 'Marigold', 'Thistle',
  'Tansy', 'Wren', 'Finch', 'Heron', 'Osprey', 'Starling', 'Pebble', 'Flint', 'Slate', 'Saffron',
  'Azure', 'Dusky', 'Mellow', 'Dappled', 'Speckled', 'Lonesome', 'Crooked', 'Drifting', 'Tumbling', 'Moonlit',
  'Starlit', 'Dewy', 'Copper', 'Cobalt', 'Ochre', 'Umber', 'Sorrel', 'Yarrow', 'Aster', 'Briar',
  'Clover', 'Fennel', 'Sedge', 'Tamarack', 'Linden', 'Alder', 'Hawthorn', 'Rowan', 'Plover', 'Kestrel',
  'Tanager', 'Pipit', 'Siskin', 'Curlew', 'Gossamer', 'Velvet', 'Pewter', 'Topaz', 'Garnet', 'Opal',
  'Jasper', 'Cinder', 'Ember', 'Lantern', 'Nettle', 'Mallow', 'Sumac', 'Teasel', 'Whimbrel', 'Bittern',
];

export const STREET_SECOND = [
  'Meadow', 'Hollow', 'Ridge', 'Glen', 'Dell', 'Vale', 'Knoll', 'Bluff', 'Crest', 'Thicket',
  'Orchard', 'Pasture', 'Harbor', 'Haven', 'Landing', 'Crossing', 'Bend', 'Run', 'Trace', 'Gap',
  'Notch', 'Hearth', 'Quarry', 'Ledge', 'Shoal', 'Marsh', 'Fen', 'Moor', 'Heath', 'Copse',
  'Brook', 'Pond', 'Cove', 'Reach', 'Furrow', 'Arbor', 'Bower', 'Paddock', 'Barrow', 'Tarn',
  'Dale', 'Glade', 'Hedge', 'Prairie', 'Mesa', 'Canyon', 'Arroyo', 'Bayou', 'Tide', 'Drift',
  'Echo', 'Feather', 'Whistle', 'Fold', 'Spur', 'Commons', 'Garth', 'Holt', 'Wold', 'Lea',
  'Mere', 'Combe', 'Rill', 'Weir', 'Wharf', 'Stile', 'Thorn', 'Overlook', 'Narrows', 'Nook',
];

export const STREET_SUFFIXES = ['St', 'Ave', 'Rd', 'Ln', 'Dr', 'Ct', 'Way', 'Pl', 'Ter', 'Cir'];

const UNIT_LETTERS = ['', '', 'A', 'B', 'C', 'D'];

// A house number from 1 to 9999. Most numbers have 3 or 4 digits, like in real addresses.
function houseNumber(randomInt) {
  const kind = randomInt(100);
  if (kind < 5) return 1 + randomInt(9);       // 1 to 9
  if (kind < 15) return 10 + randomInt(90);    // 10 to 99
  if (kind < 55) return 100 + randomInt(900);  // 100 to 999
  return 1000 + randomInt(9000);               // 1000 to 9999
}

// About 1 result in 5 has an apartment or a unit.
function unit(randomInt) {
  if (randomInt(5) !== 0) return '';
  if (randomInt(2) === 0) return `Apt ${1 + randomInt(30)}${UNIT_LETTERS[randomInt(UNIT_LETTERS.length)]}`;
  return `Unit ${1 + randomInt(300)}`;
}

// Makes one set of details. `randomInt(n)` must give a whole number from 0 to n - 1.
export function generate(randomInt) {
  const pick = (list) => list[randomInt(list.length)];
  const place = pick(CITIES);
  return {
    firstName: pick(FIRST_NAMES),
    lastName: pick(LAST_NAMES),
    street: `${houseNumber(randomInt)} ${pick(STREET_FIRST)} ${pick(STREET_SECOND)} ${pick(STREET_SUFFIXES)}`,
    unit: unit(randomInt),
    city: place.city,
    region: place.state,
    regionName: STATES[place.state],
    postalCode: pick(place.zips),
  };
}
