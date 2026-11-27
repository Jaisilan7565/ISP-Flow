import { R, MSG, yup } from '../../validation/rules';
import { LINK_ROLES, MEDIUMS } from '../shared';

/** One site — mirrors the API's siteFields (Joi). Used by the order forms and the Excel import. */
export const siteShape = {
  siteName: R.name(255).required(MSG.required),
  bandwidthMbps: R.int(1, 100000).required(MSG.required),
  linkRole: R.select(LINK_ROLES.map((x) => x.value)),
  staticIpCount: R.int(0, 256),
  address: R.text(1000).required(MSG.required),
  city: R.text(64),
  pincode: R.pincode(),
  medium: R.select(MEDIUMS.map((x) => x.value)),
  mapsUrl: R.url(),
  latitude: R.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90'),
  longitude: R.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180'),
  clientSiteRef: R.text(64),
  siteContactName: R.name(128),
  siteContactPhone: R.phone(),
  notes: R.text(5000),
  assignedTo: yup.string()
};
export const siteSchema = yup.object(siteShape);
