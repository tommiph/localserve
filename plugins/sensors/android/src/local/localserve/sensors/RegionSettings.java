package local.localserve.sensors;

import android.app.*;
import android.content.*;
import android.text.*;
import android.widget.*;
import org.json.*;
import java.util.*;

/** Private named-region editor. Copies have new IDs and start disabled. No map,
 * location lookup, remote assets or coordinates are requested by the editor. */
public final class RegionSettings {
    private final Activity activity;
    private final SharedPreferences preferences;
    private final LinearLayout rows;
    private final List<android.view.View> controls=new ArrayList<>();
    private boolean editable=true;
    public static List<RegionRules.Region> read(SharedPreferences preferences) throws JSONException {
        String text=preferences.getString("regions","[]");if(text.length()>20000)throw new IllegalArgumentException("Region settings exceed the limit");
        JSONArray array=new JSONArray(text);if(array.length()>20)throw new IllegalArgumentException("At most twenty regions");
        List<RegionRules.Region> values=new ArrayList<>();Set<String> ids=new HashSet<>(),names=new HashSet<>();
        for(int i=0;i<array.length();i++) {
            JSONObject item=array.getJSONObject(i);
            RegionRules.Region region=new RegionRules.Region(item.getString("id"),item.getString("name"),item.getDouble("latitude"),item.getDouble("longitude"),item.getDouble("radius"),item.getBoolean("enabled"));
            if(!ids.add(region.id)||!names.add(region.name.toLowerCase(Locale.ROOT)))throw new IllegalArgumentException("Region names and IDs must be unique");values.add(region);
        }
        return values;
    }
    public RegionSettings(Activity activity,LinearLayout parent) {
        this.activity=activity;preferences=activity.getSharedPreferences("sender",Context.MODE_PRIVATE);
        TextView title=new TextView(activity);title.setText("Named regions");title.setTextSize(20);parent.addView(title);
        rows=new LinearLayout(activity);rows.setOrientation(LinearLayout.VERTICAL);parent.addView(rows);render();
    }
    private void save(List<RegionRules.Region> values) throws JSONException {
        JSONArray array=new JSONArray();for(RegionRules.Region region:values)array.put(new JSONObject().put("id",region.id).put("name",region.name).put("latitude",region.latitude).put("longitude",region.longitude).put("radius",region.radius).put("enabled",region.enabled));
        preferences.edit().putString("regions",array.toString()).apply();render();
    }
    private void render() {
        rows.removeAllViews();controls.clear();
        try {
            List<RegionRules.Region> values=read(preferences);
            for(RegionRules.Region region:values) {
                Switch toggle=new Switch(activity);toggle.setText(region.name+" · "+region.radius+" m");toggle.setChecked(region.enabled);rows.addView(toggle);controls.add(toggle);
                toggle.setOnCheckedChangeListener((button,enabled)->change(region,"enabled",enabled));
                LinearLayout buttons=new LinearLayout(activity);rows.addView(buttons);
                button(buttons,"Edit",()->edit(region));button(buttons,"Copy",()->change(region,"copy",false));
                button(buttons,"Delete",()->new AlertDialog.Builder(activity).setTitle("Delete "+region.name+"?").setNegativeButton("Cancel",null).setPositiveButton("Delete",(dialog,which)->change(region,"delete",false)).show());
            }
            Button add=button(rows,"Add region",()->edit(null));add.setEnabled(editable && values.size()<20);
        } catch(Exception error) {
            TextView warning=new TextView(activity);warning.setText("Saved regions could not be read. They have been retained.");rows.addView(warning);
            button(rows,"Reset regions",()->new AlertDialog.Builder(activity).setTitle("Delete saved region settings?").setNegativeButton("Cancel",null).setPositiveButton("Reset",(dialog,which)->{preferences.edit().remove("regions").apply();render();}).show());
        }
        for(android.view.View view:controls)if(!editable)view.setEnabled(false);
    }
    private Button button(LinearLayout parent,String text,Runnable action){Button button=new Button(activity);button.setText(text);parent.addView(button);controls.add(button);button.setOnClickListener(view->action.run());return button;}
    private void change(RegionRules.Region region,String operation,boolean enabled) {
        if(!editable)return;
        try {
            List<RegionRules.Region> values=read(preferences);int index=-1;for(int i=0;i<values.size();i++)if(values.get(i).id.equals(region.id))index=i;
            if(index<0)return;
            if(operation.equals("delete"))values.remove(index);
            else if(operation.equals("enabled"))values.set(index,new RegionRules.Region(region.id,region.name,region.latitude,region.longitude,region.radius,enabled));
            else {
                if(values.size()>=20)throw new IllegalArgumentException("At most twenty regions");
                Set<String> names=new HashSet<>();for(RegionRules.Region item:values)names.add(item.name.toLowerCase(Locale.ROOT));
                String name;int count=2;do{String suffix=" "+count++;name=region.name.substring(0,Math.min(region.name.length(),32-suffix.length()))+suffix;}while(names.contains(name.toLowerCase(Locale.ROOT)));
                values.add(new RegionRules.Region(UUID.randomUUID().toString(),name,region.latitude,region.longitude,region.radius,false));
            }
            save(values);
        }catch(Exception error){Toast.makeText(activity,error.getMessage(),Toast.LENGTH_LONG).show();}
    }
    private EditText field(LinearLayout parent,String label,String value,boolean number) {
        TextView title=new TextView(activity);title.setText(label);parent.addView(title);
        EditText input=new EditText(activity);input.setSingleLine(true);input.setText(value);input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(number?24:32)});
        if(number)input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL|android.text.InputType.TYPE_NUMBER_FLAG_SIGNED);
        parent.addView(input);return input;
    }
    private void edit(RegionRules.Region existing) {
        if(!editable)return;
        LinearLayout form=new LinearLayout(activity);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(24,8,24,8);
        EditText name=field(form,"Name",existing==null?"":existing.name,false),lat=field(form,"Latitude",existing==null?"":Double.toString(existing.latitude),true),lon=field(form,"Longitude",existing==null?"":Double.toString(existing.longitude),true),radius=field(form,"Radius (metres)",existing==null?"100":Double.toString(existing.radius),true);
        TextView error=new TextView(activity);form.addView(error);
        AlertDialog dialog=new AlertDialog.Builder(activity).setTitle(existing==null?"Add region":"Edit region").setView(form).setNegativeButton("Cancel",null).setPositiveButton("Save",null).create();
        dialog.setOnShowListener(ignored->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view->{
            try {
                List<RegionRules.Region> values=read(preferences);
                RegionRules.Region region=new RegionRules.Region(existing==null?UUID.randomUUID().toString():existing.id,name.getText().toString(),Double.parseDouble(lat.getText().toString()),Double.parseDouble(lon.getText().toString()),Double.parseDouble(radius.getText().toString()),existing!=null && existing.enabled);
                if(values.stream().anyMatch(item->!item.id.equals(region.id) && item.name.equalsIgnoreCase(region.name)))throw new IllegalArgumentException("Use a different region name");
                if(existing==null){if(values.size()>=20)throw new IllegalArgumentException("At most twenty regions");values.add(region);}else for(int i=0;i<values.size();i++)if(values.get(i).id.equals(existing.id))values.set(i,region);
                save(values);dialog.dismiss();
            }catch(Exception failure){error.setText(failure instanceof NumberFormatException?"Enter numeric coordinates and radius":failure.getMessage());}
        }));dialog.show();
    }
    public void setEditable(boolean value){
        if(editable==value)return;editable=value;render();
    }
}
